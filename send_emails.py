"""
Optional companion script for sending emails via SMTP directly.
Requires Python 3.6+ and a Gmail App Password.

Usage:
  1. Export a campaign JSON from the extension's Email tab
     (the old "Export for Python Script" button is replaced by Gmail API sending,
      but you can still use this script with a manually crafted JSON file)
  2. Run: python send_emails.py campaign.json

The JSON file format:
{
  "sender": {
    "email": "your@gmail.com",
    "password": "your-app-password",
    "your_name": "Your Name",
    "resume_path": "C:/path/to/resume.pdf"
  },
  "template": {
    "subject": "Application for {position} at {company}",
    "body": "Hi {name},\\n\\n..."
  },
  "delay_range": [5, 15],
  "recipients": [
    {"job_id": "...", "email": "...", "name": "...", "position": "...", "company": "..."}
  ]
}
"""
import json
import time
import random
import sys
import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.application import MIMEApplication

def load_campaign(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

def fill_template(template, recipient, your_name=""):
    subject = template["subject"]
    body = template["body"]
    for key in ("name", "position", "company"):
        val = recipient.get(key, "")
        subject = subject.replace("{" + key + "}", val)
        body = body.replace("{" + key + "}", val)
    body = body.replace("{your_name}", your_name)
    return subject, body

def send_email(sender, recipient, subject, body, resume_path):
    msg = MIMEMultipart()
    msg["From"] = sender["email"]
    msg["To"] = recipient["email"]
    msg["Subject"] = subject
    msg.attach(MIMEText(body, "plain"))
    if resume_path and os.path.isfile(resume_path):
        with open(resume_path, "rb") as f:
            attach = MIMEApplication(f.read(), _subtype="pdf")
            attach.add_header("Content-Disposition", "attachment", filename=os.path.basename(resume_path))
            msg.attach(attach)
    with smtplib.SMTP("smtp.gmail.com", 587) as server:
        server.starttls()
        server.login(sender["email"], sender["password"])
        server.send_message(msg)

def main():
    if len(sys.argv) < 2:
        print("Usage: python send_emails.py <campaign.json>")
        sys.exit(1)
    campaign = load_campaign(sys.argv[1])
    sender = campaign["sender"]
    template = campaign["template"]
    recipients = campaign["recipients"]
    delay_min, delay_max = campaign["delay_range"]
    if not sender.get("email") or not sender.get("password"):
        print("ERROR: Sender email or password not configured in the campaign file.")
        sys.exit(1)
    if not recipients:
        print("No recipients found. Nothing to do.")
        return
    total = len(recipients)
    print(f"Sending {total} emails from {sender['email']}...")
    print(f"Delay range: {delay_min}-{delay_max} seconds")
    print("-" * 50)
    success = 0
    fail = 0
    for i, recipient in enumerate(recipients, 1):
        subject, body = fill_template(template, recipient, sender.get("your_name", ""))
        print(f"[{i}/{total}] Sending to {recipient['email']} ({recipient.get('name', 'N/A')}) - {subject}")
        try:
            send_email(sender, recipient, subject, body, sender.get("resume_path", ""))
            print(f"  -> Sent successfully")
            success += 1
        except Exception as e:
            print(f"  -> FAILED: {e}")
            fail += 1
        if i < total:
            delay = random.randint(delay_min, delay_max)
            print(f"  -> Waiting {delay}s...")
            time.sleep(delay)
    print("-" * 50)
    print(f"Done. Sent: {success}, Failed: {fail}, Total: {total}")

if __name__ == "__main__":
    main()
