"""Public "Contact us" form on the landing page.

Each message is emailed through the configured transactional provider (security_mail) to
CONTACT_EMAIL, or to AUTH_ADMIN_EMAIL when CONTACT_EMAIL is not set. Nothing is stored.
The route needs the browser protection header (see app.py) and is rate limited per IP and
overall, so it cannot be used to send bulk mail.
"""

import os
import re
import secrets

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator

from . import security_mail

router = APIRouter()

PER_IP_HOUR = 5
ALL_PER_DAY = 100
_CONTROL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")


def _clean_line(value: str) -> str:
    """One line: no control characters or line breaks, so it is safe in a subject."""
    return " ".join(_CONTROL.sub(" ", value).replace("\n", " ").split())


class ContactMessage(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: str = Field(min_length=1, max_length=100)
    email: str = Field(min_length=3, max_length=254)
    company: str = Field(default="", max_length=120)
    message: str = Field(min_length=10, max_length=2000)
    # Hidden from people; bots that fill every field are accepted and dropped.
    website: str = Field(default="", max_length=200)

    @field_validator("name", "company")
    @classmethod
    def single_line(cls, value: str) -> str:
        return _clean_line(value)

    @field_validator("email")
    @classmethod
    def valid_email(cls, value: str) -> str:
        try:
            return security_mail.normalize_email(value)
        except ValueError:
            raise ValueError("Enter a valid email address.") from None

    @field_validator("message")
    @classmethod
    def readable(cls, value: str) -> str:
        return _CONTROL.sub(" ", value)


def contact_recipient() -> str:
    raw = (
        os.environ.get("CONTACT_EMAIL", "").strip()
        or os.environ.get("AUTH_ADMIN_EMAIL", "").strip()
    )
    if not raw:
        raise HTTPException(503, "The contact form is not set up yet. Please try again later.")
    try:
        return security_mail.normalize_email(raw)
    except ValueError:
        raise HTTPException(
            503, "The contact form is not set up yet. Please try again later."
        ) from None


@router.post("/contact")
def send_contact(body: ContactMessage, request: Request):
    if body.website:
        return {"status": "sent"}
    recipient = contact_recipient()
    limits = request.app.state.limits
    if limits is not None:
        ip = request.client.host if request.client else "unknown"
        limits.take_many(
            [
                ("contact-ip", ip, PER_IP_HOUR, 3600, 1),
                ("contact-all", "all", ALL_PER_DAY, 86400, 1),
            ]
        )
    subject = f"Linecheck enquiry from {body.name}" + (f" ({body.company})" if body.company else "")
    text = (
        "A visitor sent this from the Linecheck contact form.\n\n"
        f"Name: {body.name}\n"
        f"Email: {body.email}\n"
        f"Company: {body.company or '-'}\n\n"
        f"{body.message}\n\n"
        "Reply to the visitor at the email address above.\n"
    )
    security_mail._send_message(recipient, subject[:200], text, "contact-" + secrets.token_hex(8))
    return {"status": "sent"}
