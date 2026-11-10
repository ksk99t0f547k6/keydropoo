#!/usr/bin/env python3
"""整理 Wrangler SQL 匯出順序；不連線、不執行輸入 SQL，也不覆寫原檔。"""
import argparse
import os
from pathlib import Path
import re
import sqlite3


def prepare(text: str) -> str:
    tables, data, objects = [], [], []
    start = 0
    for end in (match.end() for match in re.finditer(';', text)):
        statement = text[start:end]
        # SQLite 自己辨識引號、註解與觸發器 BEGIN/END，不能直接以分號切割。
        if not sqlite3.complete_statement(statement):
            continue
        statement = statement.strip()
        start = end
        if re.fullmatch(r'PRAGMA\s+defer_foreign_keys\s*=\s*(TRUE|ON|1)\s*;', statement, re.I):
            continue
        if re.match(r'CREATE\s+TABLE\b', statement, re.I):
            tables.append(statement)
        elif re.match(r'INSERT\s+INTO\b', statement, re.I) or re.fullmatch(r'DELETE\s+FROM\s+["\[]?sqlite_sequence["\]]?\s*;', statement, re.I):
            data.append(statement)
        elif re.match(r'CREATE\s+(?:UNIQUE\s+)?(?:INDEX|TRIGGER|VIEW)\b', statement, re.I):
            objects.append(statement)
        else:
            raise ValueError('匯出含有非預期 SQL 類型，停止處理；未輸出 SQL 本文。')
    if text[start:].strip() or not tables:
        raise ValueError('匯出不完整或沒有資料表。')
    # 資料載入前不建立觸發器，避免把還原誤認成新發碼、付款或帳本交易。
    return '\n'.join(['PRAGMA defer_foreign_keys=TRUE;', *tables, *data, *objects]) + '\n'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('destination', type=Path)
    args = parser.parse_args()
    output = prepare(args.source.read_text())
    descriptor = os.open(args.destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'w') as stream:
        stream.write(output)
    print('已產生還原 SQL，原檔未變更。僅匯入獨立空白資料庫；尚須驗證資料與外部服務狀態。')


if __name__ == '__main__':
    main()
