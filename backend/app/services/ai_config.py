from __future__ import annotations

from app.core.config import settings


class AIConfigStore:
    _instance: AIConfigStore | None = None

    def __init__(self):
        self.api_key: str = ""
        self.base_url: str = ""
        self.model: str = ""
        self.enabled: bool = False

    @classmethod
    def get(cls) -> AIConfigStore:
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    @property
    def effective_api_key(self) -> str:
        return self.api_key or settings.DEEPSEEK_API_KEY

    @property
    def effective_base_url(self) -> str:
        return self.base_url or settings.DEEPSEEK_BASE_URL

    @property
    def effective_model(self) -> str:
        return self.model or settings.DEEPSEEK_MODEL

    @property
    def is_configured(self) -> bool:
        return bool(self.effective_api_key) or self.enabled

    def update(self, *, api_key: str | None = None, base_url: str | None = None, model: str | None = None, enabled: bool | None = None) -> None:
        if api_key is not None:
            self.api_key = api_key
        if base_url is not None:
            self.base_url = base_url
        if model is not None:
            self.model = model
        if enabled is not None:
            self.enabled = enabled

    def snapshot(self) -> dict:
        return {
            "api_key": self._mask(self.api_key) if self.api_key else self._mask(settings.DEEPSEEK_API_KEY),
            "base_url": self.effective_base_url,
            "model": self.effective_model,
            "enabled": self.enabled,
            "configured": bool(self.api_key or settings.DEEPSEEK_API_KEY),
        }

    @staticmethod
    def _mask(key: str) -> str:
        if len(key) <= 8:
            return "****"
        return key[:4] + "****" + key[-4:]


ai_config = AIConfigStore.get()
