#!/usr/bin/env python3
import os
import boto3

print("=== Environment Variables ===")
print(f"AWS_REGION: {os.environ.get('AWS_REGION', 'NOT SET')}")
print(f"AWS_ACCESS_KEY_ID: {os.environ.get('AWS_ACCESS_KEY_ID', 'NOT SET')}")
print(f"AWS_SECRET_ACCESS_KEY: {'SET' if os.environ.get('AWS_SECRET_ACCESS_KEY') else 'NOT SET'}")

print("\n=== Boto3 Session Info ===")
try:
    session = boto3.Session()
    print(f"Boto3 default region: {session.region_name}")
    
    # Test creating a client with explicit region
    s3_client = boto3.client('s3', region_name=os.environ.get('AWS_REGION', 'us-east-1'))
    print("S3 client created successfully with explicit region")
    
    # Test creating a client without explicit region
    try:
        s3_client_default = boto3.client('s3')
        print("S3 client created successfully without explicit region")
    except Exception as e:
        print(f"S3 client creation failed without explicit region: {e}")
        
except Exception as e:
    print(f"Error with boto3 session: {e}")

print("\n=== All Environment Variables ===")
for key, value in sorted(os.environ.items()):
    if 'AWS' in key:
        print(f"{key}: {value}")