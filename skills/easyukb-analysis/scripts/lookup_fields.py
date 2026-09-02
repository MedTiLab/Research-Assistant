"""
lookup_fields.py - 从 UKB 字段字典查询并展开字段 ID

字典来源（按优先级）:
    1. 命令行 --dict 参数显式指定
    2. 环境变量 UKB_DICT_PATH
    3. skill 内置 assets/dataset.data_dictionary.xlsx (默认)
    4. <UKB_rawdata>/dataset.data_dictionary.xlsx
    5. <UKB_rawdata>/../dataset.data_dictionary.xlsx (同级目录)

用法:
    # 默认用 skill 内置字典
    python -X utf8 lookup_fields.py <UKB_rawdata_path> <FieldID1> [FieldID2] ...

    # 用其他字典版本
    python -X utf8 lookup_fields.py --dict <xlsx> <UKB_rawdata_path> <FieldID1> ...

示例:
    python lookup_fields.py "K:/UKB文章/00.easyUKB_AI使用/UKB_rawdata" 41270 41280 21001

输出:
    - 终端: 命中字段数 + 前 20 行预览
    - <cwd>/extracted_field_ids.txt
    - <cwd>/extracted_field_ids.R
"""

import os, re, sys, argparse, openpyxl


def find_dict(cli_dict, ukb_path):
    """按优先级查找字典文件。"""
    here = os.path.dirname(os.path.abspath(__file__))
    skill_root = os.path.dirname(here)   # scripts/.. = skill 根
    builtin = os.path.join(skill_root, "assets", "dataset.data_dictionary.xlsx")

    candidates = []
    if cli_dict:
        candidates.append(("--dict", cli_dict))
    env = os.environ.get("UKB_DICT_PATH")
    if env:
        candidates.append(("env", env))
    candidates.append(("builtin", builtin))
    if ukb_path:
        candidates.append(("ukb_rawdata", os.path.join(ukb_path, "dataset.data_dictionary.xlsx")))
        candidates.append(("ukb_rawdata_parent",
                           os.path.join(os.path.dirname(ukb_path.rstrip("/\\")),
                                        "dataset.data_dictionary.xlsx")))

    for src, path in candidates:
        if os.path.isfile(path):
            return path, src

    return None, [c[1] for c in candidates]


def lookup(xlsx_path, field_ids):
    wb = openpyxl.load_workbook(xlsx_path, read_only=True, data_only=True)
    ws = wb.worksheets[0]    # "全部字段" sheet

    rows = ws.iter_rows(values_only=True)
    headers = list(next(rows))
    h_lower = [str(h).lower() if h else "" for h in headers]
    id_col   = h_lower.index("id")
    ttl_col  = h_lower.index("title") if "title" in h_lower else id_col
    inst_col = h_lower.index("instance") if "instance" in h_lower else None
    arr_col  = h_lower.index("array") if "array" in h_lower else None

    pats = [re.compile(rf"^p{fid}(_i\d+)?(_a\d+)?$") for fid in field_ids]
    matched = []
    for row in rows:
        rid = row[id_col]
        if not rid:
            continue
        rid = str(rid)
        if any(p.match(rid) for p in pats):
            ttl  = row[ttl_col] if ttl_col is not None else ""
            inst = row[inst_col] if inst_col is not None else ""
            arr  = row[arr_col] if arr_col is not None else ""
            matched.append((rid, ttl, inst, arr))

    wb.close()
    return matched


def main():
    parser = argparse.ArgumentParser(
        description="Look up UKB FieldIDs and expand to all _iX_aY columns.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--dict", help="字段字典 xlsx 路径（覆盖内置）")
    parser.add_argument("ukb_path", help="UKB_rawdata 文件夹绝对路径（用于 set_data_path 与可选字典回退）")
    parser.add_argument("field_ids", nargs="+", help="一个或多个 UKB FieldID（数字，如 41270 21001）")
    args = parser.parse_args()

    fids = [str(x).lstrip("p").lstrip("P") for x in args.field_ids]
    xlsx, src = find_dict(args.dict, args.ukb_path)

    if xlsx is None:
        print("FATAL: dataset.data_dictionary.xlsx not found in any of:", file=sys.stderr)
        for c in src:
            print(f"  {c}", file=sys.stderr)
        sys.exit(1)

    print(f"[dict source: {src}] {xlsx}")
    print(f"[UKB_rawdata]   {args.ukb_path}")

    matched = lookup(xlsx, fids)
    print(f"\nQuery: FieldIDs = {fids}")
    print(f"Matched: {len(matched)} fields\n")

    if not matched:
        sys.exit("No fields matched. Check the FieldID(s).")

    print("--- Preview (first 20) ---")
    for r in matched[:20]:
        print(f"  {r[0]:<22} | instance={r[2]} array={r[3]} | {r[1]}")
    if len(matched) > 20:
        print(f"  ... ({len(matched) - 20} more)")

    out_txt = os.path.join(os.getcwd(), "extracted_field_ids.txt")
    with open(out_txt, "w", encoding="utf-8") as f:
        f.write("\n".join(r[0] for r in matched))
    print(f"\n[written] {out_txt}")

    out_r = os.path.join(os.getcwd(), "extracted_field_ids.R")
    with open(out_r, "w", encoding="utf-8") as f:
        f.write("field_ids <- c(\n  " +
                ",\n  ".join(f'"{r[0]}"' for r in matched) +
                "\n)\n")
    print(f"[written] {out_r}")

    print(f"\nNext step (R):")
    print(f'    source("{out_r.replace(os.sep, "/")}")')
    print(f'    library(easyUKB); set_data_path("{args.ukb_path.replace(os.sep, "/")}")')
    print(f'    df <- Common_data_extraction(id = field_ids, name = field_ids)')


if __name__ == "__main__":
    main()
