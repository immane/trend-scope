from __future__ import annotations

import resend

from app.core.config import settings


class EmailService:
    async def send_signal_alert(self, to: str, subject: str, html: str) -> str:
        if not settings.RESEND_API_KEY:
            return "dev-message-id"
        resend.api_key = settings.RESEND_API_KEY
        response = resend.Emails.send({"from": settings.EMAIL_FROM, "to": [to], "subject": subject, "html": html})
        return str(response.get("id", "sent"))
