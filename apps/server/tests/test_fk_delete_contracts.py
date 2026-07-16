"""Database-level delete contracts shared by every deployment mode."""

import pytest
from sqlalchemy import inspect, text

from db_migrations import _replace_fk_delete_action
from models import Bill, BillShare, CategoryBudget, Database, User, UserDevice, db


CASCADE_CONTRACTS = (
    ("bill_shares", "bill_id", "bills"),
    ("category_budgets", "database_id", "databases"),
    ("user_devices", "user_id", "users"),
)


@pytest.mark.parametrize("table_name,column_name,referred_table", CASCADE_CONTRACTS)
def test_model_declares_database_cascade(
    table_name, column_name, referred_table
):
    foreign_keys = [
        foreign_key
        for foreign_key in db.metadata.tables[table_name].foreign_keys
        if foreign_key.parent.name == column_name
        and foreign_key.column.table.name == referred_table
    ]

    assert len(foreign_keys) == 1
    assert foreign_keys[0].ondelete == "CASCADE"


@pytest.mark.parametrize("table_name,column_name,referred_table", CASCADE_CONTRACTS)
def test_fk_declares_database_cascade(
    app, table_name, column_name, referred_table
):
    foreign_keys = inspect(db.engine).get_foreign_keys(table_name)
    matches = [
        foreign_key
        for foreign_key in foreign_keys
        if foreign_key["constrained_columns"] == [column_name]
        and foreign_key["referred_table"] == referred_table
    ]

    assert len(matches) == 1
    assert matches[0].get("options", {}).get("ondelete", "NO ACTION").upper() == "CASCADE"


def test_migration_helper_upgrades_existing_no_action_constraint(app):
    with app.app_context():
        db.session.execute(text("DROP TABLE IF EXISTS fk_contract_child"))
        db.session.execute(text("DROP TABLE IF EXISTS fk_contract_parent"))
        db.session.execute(text('''
            CREATE TABLE fk_contract_parent (
                id INTEGER PRIMARY KEY
            )
        '''))
        db.session.execute(text('''
            CREATE TABLE fk_contract_child (
                id INTEGER PRIMARY KEY,
                parent_id INTEGER NOT NULL,
                CONSTRAINT fk_contract_child_parent_id_fkey
                    FOREIGN KEY (parent_id) REFERENCES fk_contract_parent(id)
            )
        '''))
        db.session.commit()

        try:
            _replace_fk_delete_action(
                db,
                table_name="fk_contract_child",
                column_name="parent_id",
                referred_table="fk_contract_parent",
                referred_column="id",
                ondelete="CASCADE",
            )
            db.session.commit()

            foreign_key = inspect(db.engine).get_foreign_keys("fk_contract_child")[0]
            assert foreign_key["options"]["ondelete"] == "CASCADE"
        finally:
            db.session.rollback()
            db.session.execute(text("DROP TABLE IF EXISTS fk_contract_child"))
            db.session.execute(text("DROP TABLE IF EXISTS fk_contract_parent"))
            db.session.commit()


def test_deleting_user_cascades_registered_devices(db_session):
    user = User(
        username="fk-device-user",
        email="fk-device-user@test.com",
        role="user",
    )
    device = UserDevice(
        user=user,
        device_id="fk-device",
        platform="ios",
    )
    db_session.add_all([user, device])
    db_session.commit()
    user_id = user.id
    device_id = device.id

    db_session.execute(User.__table__.delete().where(User.id == user_id))
    db_session.commit()

    assert db_session.get(UserDevice, device_id) is None


def test_deleting_bill_cascades_bill_shares(db_session):
    owner = User(
        username="fk-share-owner",
        email="fk-share-owner@test.com",
        role="admin",
    )
    recipient = User(
        username="fk-share-recipient",
        email="fk-share-recipient@test.com",
        role="user",
        created_by=owner,
    )
    database = Database(
        name="fk-share-db",
        display_name="FK Share DB",
        owner=owner,
    )
    bill = Bill(
        database=database,
        name="FK Share Bill",
        amount=20.00,
        frequency="monthly",
        due_date="2026-08-01",
        type="expense",
    )
    share = BillShare(
        bill=bill,
        owner=owner,
        shared_with=recipient,
        shared_with_identifier=recipient.username,
        identifier_type="username",
        status="accepted",
    )
    db_session.add_all([owner, recipient, database, bill, share])
    db_session.commit()
    bill_id = bill.id
    share_id = share.id

    db_session.execute(Bill.__table__.delete().where(Bill.id == bill_id))
    db_session.commit()

    assert db_session.get(BillShare, share_id) is None


def test_deleting_database_cascades_category_budgets(db_session):
    database = Database(
        name="fk-budget-db",
        display_name="FK Budget DB",
    )
    budget = CategoryBudget(
        database=database,
        category="Housing",
        monthly_limit=1000.00,
    )
    db_session.add_all([database, budget])
    db_session.commit()
    database_id = database.id
    budget_id = budget.id

    db_session.execute(
        Database.__table__.delete().where(Database.id == database_id)
    )
    db_session.commit()

    assert db_session.get(CategoryBudget, budget_id) is None
