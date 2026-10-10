"""scripts/export_aws_to_supabase.py - Export DynamoDB items to Supabase audit_results.

Usage:
    python scripts/export_aws_to_supabase.py [--dry-run] [--copy-s3]

Requires env vars:
    AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_DEFAULT_REGION  (from environment)
    SUPABASE_URL, SUPABASE_SECRET_KEY                              (from environment)

Prints counts only; never prints document content or secrets.
"""

import argparse
import json
import os
import sys
from decimal import Decimal


def decimal_default(obj):
    if isinstance(obj, Decimal):
        return int(obj) if obj == obj.to_integral_value() else float(obj)
    raise TypeError(f"Object of type {type(obj).__name__} is not JSON serializable")


def main():
    parser = argparse.ArgumentParser(description="Export AWS DynamoDB audit results to Supabase")
    parser.add_argument("--dry-run", action="store_true", help="Read and count items without writing to Supabase")
    parser.add_argument("--copy-s3", action="store_true", help="Also copy S3 objects to Supabase Storage")
    parser.add_argument("--table", default="ComplianceAuditLogs", help="DynamoDB table name")
    parser.add_argument("--bucket", default="enterprise-compliance-vault-2026", help="S3 bucket name")
    parser.add_argument("--storage-bucket", default="audit-uploads", help="Supabase Storage bucket name")
    args = parser.parse_args()

    # Validate env
    supabase_url = os.environ.get("SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_SECRET_KEY")
    if not supabase_url or not supabase_key:
        print("ERROR: SUPABASE_URL and SUPABASE_SECRET_KEY must be set in the environment.")
        sys.exit(1)

    # Lazy imports
    import boto3
    from supabase import create_client

    sb = create_client(supabase_url, supabase_key)
    ddb = boto3.resource("dynamodb")
    table = ddb.Table(args.table)

    # Scan DynamoDB
    print(f"Scanning DynamoDB table: {args.table}")
    items = []
    scan_kwargs = {}
    while True:
        response = table.scan(**scan_kwargs)
        items.extend(response.get("Items", []))
        last_key = response.get("LastEvaluatedKey")
        if not last_key:
            break
        scan_kwargs["ExclusiveStartKey"] = last_key

    print(f"Found {len(items)} items in DynamoDB")

    completed = [i for i in items if i.get("Status") == "COMPLETED"]
    failed = [i for i in items if i.get("Status") == "FAILED"]
    other = [i for i in items if i.get("Status") not in ("COMPLETED", "FAILED")]
    print(f"  COMPLETED: {len(completed)}")
    print(f"  FAILED:    {len(failed)}")
    print(f"  Other:     {len(other)}")

    if args.dry_run:
        print("\n--dry-run: no writes performed.")
        return

    # Upsert into Supabase
    upserted = 0
    errors = 0
    for item in items:
        doc_id = item.get("DocumentId")
        if not doc_id:
            continue
        status = item.get("Status", "UNKNOWN")

        # Build the result JSON (strip Decimal types for JSON serialization)
        result_json = json.loads(json.dumps(dict(item), default=decimal_default)) if status == "COMPLETED" else None

        row = {
            "document_id": doc_id,
            "status": status,
            "result": result_json,
            "error": item.get("Error"),
            "backend": "aws",
        }

        try:
            sb.table("audit_results").upsert(row, on_conflict="document_id").execute()
            upserted += 1
        except Exception as e:
            errors += 1
            print(f"  Error upserting {doc_id}: {type(e).__name__}")

    print(f"\nUpserted: {upserted}, Errors: {errors}")

    # Optional: copy S3 objects
    if args.copy_s3:
        s3 = boto3.client("s3")
        print(f"\nCopying S3 objects from {args.bucket} to Supabase Storage bucket '{args.storage_bucket}'...")
        paginator = s3.get_paginator("list_objects_v2")
        copied = 0
        s3_errors = 0
        for page in paginator.paginate(Bucket=args.bucket, Prefix="uploads/"):
            for obj in page.get("Contents", []):
                key = obj["Key"]
                try:
                    body = s3.get_object(Bucket=args.bucket, Key=key)["Body"].read()
                    # Upload to Supabase Storage
                    sb.storage.from_(args.storage_bucket).upload(key, body, {"upsert": "true"})
                    copied += 1
                except Exception as e:
                    s3_errors += 1
                    print(f"  Error copying {key}: {type(e).__name__}")
        print(f"S3 objects copied: {copied}, Errors: {s3_errors}")

    print("\nExport complete.")


if __name__ == "__main__":
    main()
