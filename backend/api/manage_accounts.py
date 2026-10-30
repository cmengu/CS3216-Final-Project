"""Operator tools for first-admin setup and explicit legacy workspace recovery."""

import argparse
import os
import secrets
from pathlib import Path

from .accounts import Accounts
from .storage import open_store

BACKEND = Path(__file__).resolve().parents[1]


def load_settings():
    path = BACKEND / ".env"
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip() and not line.lstrip().startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                os.environ.setdefault(key.strip(), value.strip())
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
    setup_token = secrets.token_urlsafe(32)
    original = env_file.read_text(encoding="utf-8").splitlines() if env_file.exists() else []
    kept = [
        line
        for line in original
        if line.partition("=")[0].strip()
        not in (
            {"AUTH_SECRET", "AUTH_SETUP_TOKEN", "AUTH_USERNAME", "AUTH_PASSWORD"}
            if obsolete_demo
            else {"AUTH_SECRET", "AUTH_SETUP_TOKEN"}
        )
    ]
    env_file.write_text(
        "\n".join([*kept, f"AUTH_SECRET={secret}", f"AUTH_SETUP_TOKEN={setup_token}", ""]),
        encoding="utf-8",
    )
    os.chmod(env_file, 0o600)
    url_file = store.directory / "admin-setup.url"
    frontend = os.environ.get("FRONTEND_URL", "http://localhost:3000").rstrip("/")
    url_file.write_text(
        f"[InternetShortcut]\nURL={frontend}/setup#token={setup_token}\n", encoding="utf-8"
    )
    os.chmod(url_file, 0o600)
    print(f"One-time administrator setup link saved to: {url_file}")
    print(
        "Restart the backend, then open that link and choose your administrator username and password."
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("prepare-setup")
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
                for table in ("invoices", "master_lists"):
                    if accounts.execute(
                        db,
                        f"SELECT 1 FROM {accounts.table(table)} WHERE session_id=? LIMIT 1",
                        (target,),
                    ).fetchone():
                        raise ValueError(
                            "The target workspace already has data. No data was moved."
                        )
                for table in ("invoices", "master_lists"):
                    accounts.execute(
                        db,
                        f"UPDATE {accounts.table(table)} SET session_id=? WHERE session_id=?",
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
