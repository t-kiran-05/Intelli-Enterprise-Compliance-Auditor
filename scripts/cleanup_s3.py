#!/usr/bin/env python3
"""
cleanup_s3.py
Enforces 24-hour retention lifecycle on AWS S3 document vault.
Lists and purges document objects uploaded more than 24 hours ago.
"""

import datetime
import os
import sys
import boto3

BUCKET_NAME = os.environ.get("S3_BUCKET_NAME", "enterprise-compliance-vault-2026")
RETENTION_HOURS = 24


def cleanup_expired_documents():
    print(f"=== S3 DATA LIFECYCLE & CLEANUP UTILITY ===")
    print(f"Target Bucket: {BUCKET_NAME}")
    print(f"Retention Policy: Delete objects older than {RETENTION_HOURS} hours\n")

    try:
        s3 = boto3.client(
            "s3",
            region_name=os.environ.get("AWS_REGION", "us-east-1"),
        )
    except Exception as e:
        print(f"[Error] Could not initialize AWS S3 client: {e}")
        sys.exit(1)

    now = datetime.datetime.now(datetime.timezone.utc)
    cutoff = now - datetime.timedelta(hours=RETENTION_HOURS)

    print(f"Current UTC Time: {now.isoformat()}")
    print(f"Purge Cutoff Time: {cutoff.isoformat()}\n")

    paginator = s3.get_paginator("list_objects_v2")
    pages = paginator.paginate(Bucket=BUCKET_NAME)

    total_scanned = 0
    deleted_count = 0

    for page in pages:
        contents = page.get("Contents", [])
        for obj in contents:
            total_scanned += 1
            key = obj["Key"]
            last_modified = obj["LastModified"]
            age_hours = (now - last_modified).total_seconds() / 3600.0

            if last_modified < cutoff:
                print(f"[EXPIRED] Deleting '{key}' (Age: {age_hours:.1f} hours)...", end="")
                try:
                    s3.delete_object(Bucket=BUCKET_NAME, Key=key)
                    deleted_count += 1
                    print(" DELETED")
                except Exception as del_err:
                    print(f" ERROR: {del_err}")
            else:
                print(f"[ACTIVE] Retaining '{key}' (Age: {age_hours:.1f} hours)")

    print("\n" + "=" * 50)
    print(f"Cleanup Complete. Scanned: {total_scanned} objects | Deleted: {deleted_count} expired objects.")
    print("=" * 50)


if __name__ == "__main__":
    cleanup_expired_documents()
