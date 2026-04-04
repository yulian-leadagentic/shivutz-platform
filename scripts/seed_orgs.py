"""Create org records for existing users that have no org, then link them."""
import pymysql, os, uuid, json
from datetime import datetime, timedelta

MYSQL_HOST = os.getenv("MYSQL_HOST", "127.0.0.1")
MYSQL_PORT = int(os.getenv("MYSQL_PORT", "3306"))
MYSQL_PW   = os.getenv("MYSQL_ROOT_PASSWORD", "shivutz_dev")

cfg = dict(host=MYSQL_HOST, port=MYSQL_PORT, user="root", password=MYSQL_PW,
           charset="utf8mb4", autocommit=False,
           cursorclass=pymysql.cursors.DictCursor)

auth_conn = pymysql.connect(**cfg, database="auth_db")
org_conn  = pymysql.connect(**cfg, database="org_db")

try:
    # 1. Find users with no org_id
    with auth_conn.cursor() as c:
        c.execute("SELECT id, email, role FROM users WHERE org_id IS NULL AND role IN ('contractor','corporation')")
        users = c.fetchall()

    print(f"Found {len(users)} users without org:")
    for u in users:
        print(f"  {u['email']} ({u['role']})")

    deadline = datetime.utcnow() + timedelta(hours=48)

    for u in users:
        org_id = str(uuid.uuid4())
        name   = u['email'].split('@')[0]

        with org_conn.cursor() as c:
            if u['role'] == 'contractor':
                c.execute(
                    """INSERT INTO contractors
                       (id, user_owner_id, company_name, company_name_he, business_number,
                        classification, operating_regions, contact_name, contact_phone,
                        contact_email, approval_sla_deadline, approval_status)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'approved')""",
                    (org_id, u['id'], name, name, '000000000',
                     'general', json.dumps(['center']),
                     name, '000-0000000', u['email'], deadline)
                )
            else:
                c.execute(
                    """INSERT INTO corporations
                       (id, user_owner_id, company_name, company_name_he, business_number,
                        countries_of_origin, minimum_contract_months, contact_name,
                        contact_phone, contact_email, approval_sla_deadline, approval_status)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'approved')""",
                    (org_id, u['id'], name, name, '000000000',
                     json.dumps(['RO']), 3,
                     name, '000-0000000', u['email'], deadline)
                )

            # Link user → org
            c.execute(
                "INSERT IGNORE INTO org_users (id, user_id, org_id, org_type, role, joined_at) VALUES (%s,%s,%s,%s,'owner',NOW())",
                (str(uuid.uuid4()), u['id'], org_id, u['role'])
            )
        org_conn.commit()

        # Update auth user with org_id
        with auth_conn.cursor() as c:
            c.execute("UPDATE users SET org_id=%s, org_type=%s WHERE id=%s",
                      (org_id, u['role'], u['id']))
        auth_conn.commit()

        print(f"  ✓ Created org {org_id} for {u['email']}")

    print("Done.")
finally:
    auth_conn.close()
    org_conn.close()
