import os
import sqlite3
import json
import traceback
from models import db, User, Database, Bill, Payment

def migrate_sqlite_to_pg(app):
    """
    Migrates data from legacy SQLite files (data/master.db and dbs/*.db) 
    to the new PostgreSQL database.
    """
    base_dir = os.path.dirname(os.path.abspath(__file__))
    data_dir = os.path.join(base_dir, '..', 'data')
    dbs_dir = os.path.join(base_dir, '..', 'dbs')
    master_db_path = os.path.join(data_dir, 'master.db')
    flag_file = os.path.join(data_dir, 'migration_complete.flag')

    # Check if migration is needed
    if os.path.exists(flag_file):
        print("Migration flag found. Skipping migration.")
        return

    if not os.path.exists(master_db_path):
        print("No legacy master.db found. Skipping migration.")
        return

    print("🚀 Starting migration from SQLite to PostgreSQL...")

    with app.app_context():
        # Connect to Master DB
        try:
            conn_master = sqlite3.connect(master_db_path)
            conn_master.row_factory = sqlite3.Row
            cursor_master = conn_master.cursor()
        except Exception as e:
            print(f"❌ Could not connect to master.db: {e}")
            return

        # 1. Migrate Users
        print("Migrating Users...")
        user_map = {} # old_id -> new_User_obj
        try:
            cursor_master.execute("SELECT * FROM users")
            old_users = cursor_master.fetchall()
            
            for row in old_users:
                # Check if user exists
                username = row['username']
                existing_user = User.query.filter_by(username=username).first()
                if not existing_user:
                    new_user = User(
                        username=username,
                        password_hash=row['password_hash'],
                        role=row['role'],
                        password_change_required=bool(row['password_change_required']) if 'password_change_required' in row.keys() else False,
                        change_token=row['change_token'] if 'change_token' in row.keys() else None
                    )
                    db.session.add(new_user)
                    db.session.flush() # Get ID
                    print(f"  + Added user: {username}")
                    user_map[row['id']] = new_user
                else:
                    print(f"  * User exists: {username}")
                    user_map[row['id']] = existing_user
            
            db.session.commit()
            print("  ✅ User commit successful.")
            
            # Immediate Verification
            all_pg_users = [u.username for u in User.query.all()]
            print(f"  Current users in PG: {all_pg_users}")
            
        except Exception as e:
            print(f"❌ Error migrating users: {e}")
            db.session.rollback()
            traceback.print_exc()

        # 2. Migrate Databases (Metadata)
        print("Migrating Databases...")
        db_map = {} # old_id -> new_Database_obj
        try:
            cursor_master.execute("SELECT * FROM databases")
            old_dbs = cursor_master.fetchall()
            
            for row in old_dbs:
                name = row['name']
                existing_db = Database.query.filter_by(name=name).first()
                if not existing_db:
                    new_db = Database(
                        name=name,
                        display_name=row['display_name'],
                        description=row['description']
                    )
                    db.session.add(new_db)
                    db.session.flush()
                    print(f"  + Added database info: {name}")
                    db_map[row['id']] = new_db
                else:
                    print(f"  * Database info exists: {name}")
                    db_map[row['id']] = existing_db
            
            db.session.commit()
            print("  ✅ Database metadata commit successful.")
        except Exception as e:
            print(f"❌ Error migrating databases: {e}")
            db.session.rollback()
            traceback.print_exc()

        # 3. Migrate User Access
        print("Migrating Access Permissions...")
        try:
            cursor_master.execute("SELECT * FROM user_database_access")
            access_rows = cursor_master.fetchall()
            
            for row in access_rows:
                u_obj = db.session.get(User, user_map[row['user_id']].id) if row['user_id'] in user_map else None
                d_obj = db.session.get(Database, db_map[row['database_id']].id) if row['database_id'] in db_map else None
                
                if u_obj and d_obj:
                    if d_obj not in u_obj.accessible_databases:
                        u_obj.accessible_databases.append(d_obj)
                        print(f"  + Granted {u_obj.username} access to {d_obj.name}")
            
            db.session.commit()
            print("  ✅ Access permissions commit successful.")
        except Exception as e:
            print(f"❌ Error migrating access: {e}")
            db.session.rollback()
            traceback.print_exc()

        conn_master.close()

        # 4. Migrate Bills and Payments for each Database
        print("Migrating Bills and Payments...")
        # Re-fetch dbs from PG to be safe
        all_dbs = Database.query.all()
        for new_db_obj in all_dbs:
            sqlite_path = os.path.join(dbs_dir, f"{new_db_obj.name}.db")
            if not os.path.exists(sqlite_path):
                print(f"  ⚠️  SQLite file not found for {new_db_obj.name}, skipping detailed data.")
                continue
            
            print(f"  Processing data for database: {new_db_obj.name}...")
            try:
                conn_db = sqlite3.connect(sqlite_path)
                conn_db.row_factory = sqlite3.Row
                cursor_db = conn_db.cursor()
                
                # Migrate Bills
                cursor_db.execute("SELECT * FROM bills")
                old_bills = cursor_db.fetchall()
                
                bill_id_map = {} # old_bill_id -> new_bill_id
                
                for row in old_bills:
                    # Check if bill already exists in this DB (by name)
                    existing_bill = Bill.query.filter_by(database_id=new_db_obj.id, name=row['name']).first()
                    if existing_bill:
                        print(f"    * Bill '{row['name']}' already exists, linking for payment migration.")
                        bill_id_map[row['id']] = existing_bill.id
                        continue

                    keys = row.keys()
                    new_bill = Bill(
                        database_id=new_db_obj.id,
                        name=row['name'],
                        amount=row['amount'],
                        is_variable=bool(row['varies']) if 'varies' in keys else False,
                        frequency=row['frequency'],
                        frequency_type=row['frequency_type'] if 'frequency_type' in keys else 'simple',
                        frequency_config=row['frequency_config'] if 'frequency_config' in keys else '{}',
                        due_date=row['next_due'],
                        auto_pay=bool(row['auto_payment']) if 'auto_payment' in keys else False,
                        icon=row['icon'] if 'icon' in keys else 'payment',
                        type=row['type'] if 'type' in keys else 'expense',
                        account=row['account'] if 'account' in keys else None,
                        archived=bool(row['archived']) if 'archived' in keys else False
                    )
                    db.session.add(new_bill)
                    db.session.flush() # Get ID
                    bill_id_map[row['id']] = new_bill.id
                
                print(f"    - Migrated {len(bill_id_map)} bills.")

                # Migrate Payments
                cursor_db.execute("SELECT * FROM payments")
                old_payments = cursor_db.fetchall()
                count_payments = 0
                
                for row in old_payments:
                    new_bill_id = bill_id_map.get(row['bill_id'])
                    if new_bill_id:
                        # Check if payment already exists (simple check by bill, amount, date)
                        existing_payment = Payment.query.filter_by(
                            bill_id=new_bill_id, 
                            amount=row['amount'], 
                            payment_date=row['payment_date']
                        ).first()
                        
                        if not existing_payment:
                            new_payment = Payment(
                                bill_id=new_bill_id,
                                amount=row['amount'],
                                payment_date=row['payment_date']
                            )
                            db.session.add(new_payment)
                            count_payments += 1
                
                print(f"    - Migrated {count_payments} payments.")
                conn_db.close()
                db.session.commit()
                print(f"    ✅ Commit for {new_db_obj.name} successful.")

            except Exception as e:
                print(f"  ❌ Error processing {new_db_obj.name}: {e}")
                db.session.rollback()
                traceback.print_exc()

        # Finalize
        print("✅ Migration process finished.")
        with open(flag_file, 'w') as f:
            f.write(f"Migration completed on {os.popen('date').read().strip()}")