from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    APP_ENV: str = "development"

    MYSQL_ROOT_PASSWORD: str = "rootpassword"
    MYSQL_DATABASE: str = "trend_scope"
    MYSQL_USER: str = "trendscope"
    MYSQL_PASSWORD: str = "trendscope123"
    DATABASE_URL: str = "mysql+asyncmy://trendscope:trendscope123@localhost:3306/trend_scope"

    REDIS_URL: str = "redis://localhost:6379/0"

    JWT_SECRET_KEY: str = "dev-jwt-secret-change-in-production"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30

    DEEPSEEK_API_KEY: str = ""
    DEEPSEEK_BASE_URL: str = "https://api.deepseek.com/v1"
    DEEPSEEK_MODEL: str = "deepseek-chat"

    RESEND_API_KEY: str = ""
    EMAIL_FROM: str = "Trend-Scope <alerts@trend-scope.com>"

    CORS_ORIGINS: str = "http://localhost:3000,http://localhost:8000"

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",") if origin.strip()]

    model_config = {
        "env_file": ".env",
        "env_file_encoding": "utf-8",
        "case_sensitive": True,
    }


settings = Settings()
