from __future__ import annotations

import ast

import numpy as np
import pandas as pd


class ScriptValidationError(ValueError):
    pass


class ScriptExecutor:
    blocked_imports = {"os", "sys", "subprocess", "socket", "requests", "pathlib", "shutil"}

    def validate(self, script: str) -> None:
        if not script.strip():
            raise ScriptValidationError("脚本不能为空")
        try:
            tree = ast.parse(script)
        except SyntaxError as exc:
            raise ScriptValidationError(f"脚本语法错误: {exc.msg}") from exc
        has_analyze = False
        for node in ast.walk(tree):
            if isinstance(node, ast.FunctionDef) and node.name == "analyze":
                has_analyze = True
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                names = [alias.name.split(".")[0] for alias in getattr(node, "names", [])]
                if isinstance(node, ast.ImportFrom) and node.module:
                    names.append(node.module.split(".")[0])
                blocked = self.blocked_imports.intersection(names)
                if blocked:
                    raise ScriptValidationError(f"禁止导入模块: {', '.join(sorted(blocked))}")
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in {"open", "exec", "eval", "compile", "__import__"}:
                raise ScriptValidationError(f"禁止调用函数: {node.func.id}")
        if not has_analyze:
            raise ScriptValidationError("脚本必须定义 analyze(df, params) 函数")

    def run(self, script: str, df: pd.DataFrame, params: dict) -> pd.Series | pd.DataFrame:
        self.validate(script)
        globals_dict = {
            "pd": pd,
            "np": np,
            "__builtins__": {
                "abs": abs,
                "bool": bool,
                "float": float,
                "int": int,
                "len": len,
                "max": max,
                "min": min,
                "range": range,
                "round": round,
                "sum": sum,
            },
        }
        locals_dict: dict = {}
        exec(compile(script, "<strategy_script>", "exec"), globals_dict, locals_dict)
        analyze = locals_dict.get("analyze") or globals_dict.get("analyze")
        if not callable(analyze):
            raise ScriptValidationError("脚本必须定义 analyze(df, params) 函数")
        result = analyze(df.copy(), params or {})
        if not isinstance(result, (pd.Series, pd.DataFrame)):
            raise ScriptValidationError("analyze() 必须返回 pandas.Series 或 pandas.DataFrame")
        return result
