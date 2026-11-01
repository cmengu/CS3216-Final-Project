"""Operator tools for first-admin setup and explicit legacy workspace recovery."""

import argparse
import os
import secrets
from pathlib import Path
from uuid import uuid4

from .accounts import Accounts
from .storage import open_store

BACKEND = Path(__file__).resolve().parents[1]


def load_settings():
    path = BACKEND / ".env"
    for settings in (path, BACKEND / ".env.email"):
        if not settings.exists():
            continue
        for line in settings.read_text(encoding="utf-8").splitlines():
            if line.strip() and not line.lstrip().startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                value = value.strip()
                if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
                    value = value[1:-1]
                os.environ.setdefault(key.strip(), value)
    return path


def prepare_setup(env_file, store, accounts):
    if accounts.has_accounts():
        raise ValueError("Accounts already exist. Sign in as an administrator instead.")
    obsolete_demo = (
        os.environ.get("AUTH_USERNAME", "").lower() == "demo-account"
        and os.environ.get("AUTH_PASSWORD") == "invoice-checker"
    )
    if (os.environ.get("AUTH_USERNAME") or os.environ.get("AUTH_PASSWORD")) and not obsolete_demo:
        raise ValueError(
            "Remove obsolete AUTH_USERNAME/AUTH_PASSWORD settings before using one-time setup."
        )
    secret = os.environ.get("AUTH_SECRET", "")
    if len(secret) < 32:
        secret = secrets.token_urlsafe(48)
    mfa_key = os.environ.get("AUTH_MFA_KEY", "").strip() or secrets.token_urlsafe(48)
    original = env_file.read_text(encoding="utf-8").splitlines() if env_file.exists() else []
    kept = [
        line
        for line in original
        if line.partition("=")[0].strip()
        not in (
            {"AUTH_SECRET", "AUTH_SETUP_TOKEN", "AUTH_MFA_KEY", "AUTH_USERNAME", "AUTH_PASSWORD"}
            if obsolete_demo
            else {"AUTH_SECRET", "AUTH_SETUP_TOKEN", "AUTH_MFA_KEY"}
        )
    ]
    env_file.write_text(
        "\n".join(
            [
                *kept,
                f"AUTH_SECRET={secret}",
                f"AUTH_MFA_KEY={mfa_key}",
                "",
            ]
        ),
        encoding="utf-8",
    )
    os.chmod(env_file, 0o600)
    url_file = store.directory / "admin-setup.url"
    frontend = os.environ.get("FRONTEND_URL", "http://localhost:3000").rstrip("/")
    url_file.write_text(f"[InternetShortcut]\nURL={frontend}/setup\n", encoding="utf-8")
    os.chmod(url_file, 0o600)
    print(f"Administrator setup link saved to: {url_file}")
    print(
        "Restart the backend, open the link, verify the approved email, then choose your administrator credentials."
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("prepare-setup")
    reset = sub.add_parser(
        "reset-2fa", help="Operator-only recovery when an account lost all second factors"
    )
    reset.add_argument("--username", required=True)
    email = sub.add_parser(
        "set-email", help="Assign an account's independently verified security email"
    )
    email.add_argument("--username", required=True)
    email.add_argument("--email", required=True)
    recover = sub.add_parser("recover-workspace")
    recover.add_argument(
        "--source", required=True, help="Exact old session/workspace ID; never inferred"
    )
    recover.add_argument("--username", required=True, help="Approved account that owns this data")
    args = parser.parse_args()
    env_file = load_settings()
    directory = Path(os.environ.get("INVOICE_DATA_DIR", BACKEND / "runtime"))
    if not directory.is_absolute():
        directory = BACKEND / directory
    store = open_store(directory)
    accounts = Accounts(store)
    try:
        if args.command == "prepare-setup":
            prepare_setup(env_file, store, accounts)
        elif args.command in {"reset-2fa", "set-email"}:
            with accounts.connect() as db:
                row = accounts.execute(
                    db,
                    f"SELECT id FROM {accounts.table('approved_accounts')} WHERE username=?",
                    (args.username.strip().lower(),),
                ).fetchone()
            if row is None:
                raise ValueError("The approved account does not exist.")
            accounts.mfa.set_by_operator(
                row["id"], args.email if args.command == "set-email" else None
            )
            print(
                "Security email verification reset. Existing sessions were invalidated; the next sign-in requires a code sent to the registered address."
            )
        else:
            with accounts.connect() as db:
                row = accounts.execute(
                    db,
                    f"SELECT id,workspace_id FROM {accounts.table('approved_accounts')} WHERE username=?",
                    (args.username.strip().lower(),),
                ).fetchone()
                if not row:
                    raise ValueError("The approved account does not exist.")
                target = row["workspace_id"]
                accounts._lock(db)
                if args.source == target:
                    raise ValueError("Source and destination are the same workspace.")
                if accounts.execute(
                    db,
                    f"SELECT 1 FROM {accounts.table('approved_accounts')} WHERE workspace_id=?",
                    (args.source,),
                ).fetchone():
                    raise ValueError(
                        "The source belongs to an approved account; it cannot be reassigned."
                    )
                if accounts.execute(
                    db,
                    f"SELECT 1 FROM {accounts.table('invoice_jobs')} WHERE workspace_id=? AND status IN ('queued','running') LIMIT 1",
                    (args.source,),
                ).fetchone():
                    raise ValueError(
                        "The source has unfinished jobs. Let them finish before recovering its data."
                    )
                for table in ("invoices", "master_lists", "projects"):
                    if accounts.execute(
                        db,
                        f"SELECT 1 FROM {accounts.table(table)} WHERE session_id=? LIMIT 1",
                        (target,),
                    ).fetchone():
                        raise ValueError(
                            "The target workspace already has data. No data was moved."
                        )
                projects = accounts.execute(
                    db,
                    f"SELECT * FROM {accounts.table('projects')} WHERE session_id=?",
                    (args.source,),
                ).fetchall()
                for project in projects:
                    project_id = (
                        "legacy:" + target
                        if project["id"] == "legacy:" + args.source
                        else str(uuid4())
                    )
                    accounts.execute(
                        db,
                        f"INSERT INTO {accounts.table('projects')} (id,session_id,name,comparison_mode,created_at) VALUES (?,?,?,?,?)",
                        (
                            project_id,
                            target,
                            project["name"],
                            project["comparison_mode"],
                            project["created_at"],
                        ),
                    )
                    for table in ("invoices", "master_lists"):
                        accounts.execute(
                            db,
                            f"UPDATE {accounts.table(table)} SET session_id=?,project_id=? WHERE session_id=? AND project_id=?",
                            (target, project_id, args.source, project["id"]),
                        )
                accounts.execute(
                    db,
                    f"DELETE FROM {accounts.table('projects')} WHERE session_id=?",
                    (args.source,),
                )
                for table in ("invoice_batches", "invoice_jobs"):
                    accounts.execute(
                        db,
                        f"UPDATE {accounts.table(table)} SET workspace_id=? WHERE workspace_id=?",
                        (target, args.source),
                    )
                accounts.execute(
                    db,
                    f"DELETE FROM {accounts.table('storage_limits')} WHERE workspace_id IN (?,?)",
                    (args.source, target),
                )
                accounts._event(db, "operator", row["id"], "legacy_workspace_recovered")
            print(
                "Legacy invoices and master lists moved to the explicitly selected private workspace. Reconnect Outlook separately."
            )
    finally:
        if hasattr(store, "pool"):
            store.pool.close()


if __name__ == "__main__":
    main()
