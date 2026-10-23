"""Payment statistics classification and calendar-year boundaries."""
import datetime

import pytest

import config
from models import Bill, BillShare, Database, Payment


def _create_recipient_database(db_session, regular_user):
    database = Database(
        name='recipientdb',
        display_name='Recipient Database',
        description='Database for stats recipient tests',
        owner_id=regular_user.id if config.is_saas() else None,
    )
    db_session.add(database)
    db_session.commit()
    regular_user.accessible_databases.append(database)
    db_session.commit()
    return database


def _headers(base, database_name):
    headers = base.copy()
    headers['X-Database'] = database_name
    return headers


@pytest.fixture
def stats_fixture(
    db_session,
    test_database,
    test_bill,
    admin_user,
    regular_user,
    auth_headers_with_db,
    user_auth_headers,
):
    """Owner and sharee payments around a calendar-year boundary."""
    current_year = datetime.date.today().year
    previous_year = current_year - 1
    dates = {
        'previous_year_end': f'{previous_year}-12-31',
        'current_year_start': f'{current_year}-01-01',
        'current_february': f'{current_year}-02-01',
        'current_june': f'{current_year}-06-15',
    }
    paycheck = Bill(
        database_id=test_database.id,
        name='Paycheck',
        amount=200,
        frequency='monthly',
        due_date=dates['current_year_start'],
        type='deposit',
        account='Checking',
    )
    cash = Bill(
        database_id=test_database.id,
        name='Cash expense',
        amount=5,
        frequency='once',
        due_date=dates['current_february'],
        type='expense',
        account=None,
    )
    db_session.add_all([paycheck, cash])
    db_session.commit()

    share = BillShare(
        bill_id=test_bill.id,
        owner_user_id=admin_user.id,
        shared_with_user_id=regular_user.id,
        shared_with_identifier=regular_user.username,
        identifier_type='username',
        status='accepted',
        split_type='fixed',
        split_value=30,
        accepted_at=datetime.datetime.now(datetime.timezone.utc),
    )
    db_session.add(share)
    db_session.commit()

    db_session.add_all([
        Payment(
            bill_id=test_bill.id,
            amount=80,
            payment_date=dates['previous_year_end'],
        ),
        Payment(
            bill_id=paycheck.id,
            amount=200,
            payment_date=dates['current_year_start'],
        ),
        Payment(
            bill_id=cash.id,
            amount=5,
            payment_date=dates['current_february'],
        ),
        Payment(
            bill_id=test_bill.id,
            amount=30,
            payment_date=dates['current_june'],
            share_id=share.id,
        ),
    ])
    db_session.commit()

    recipient_db = _create_recipient_database(db_session, regular_user)
    return {
        'dates': dates,
        'current_year': current_year,
        'previous_year': previous_year,
        'owner_headers': auth_headers_with_db,
        'sharee_headers': _headers(user_auth_headers, recipient_db.name),
    }


def _year(payload, year):
    return payload[str(year)]


class TestStatsClassification:
    def test_yearly_stats_keep_year_boundaries_and_share_direction(
        self, client, stats_fixture
    ):
        response = client.get('/api/v2/stats/yearly', headers=stats_fixture['owner_headers'])

        assert response.status_code == 200
        payload = response.get_json()['data']
        previous = _year(payload, stats_fixture['previous_year'])
        current = _year(payload, stats_fixture['current_year'])
        assert previous['expenses'] == pytest.approx(80)
        assert previous['deposits'] == pytest.approx(0)
        # December 31 must stay in the previous year, and the sharee's payment
        # is income for the owner rather than another expense.
        assert current['expenses'] == pytest.approx(5)
        assert current['deposits'] == pytest.approx(230)

        sharee = client.get('/api/v2/stats/yearly', headers=stats_fixture['sharee_headers'])
        assert sharee.status_code == 200
        sharee_year = _year(sharee.get_json()['data'], stats_fixture['current_year'])
        assert sharee_year['expenses'] == pytest.approx(30)
        assert sharee_year['deposits'] == pytest.approx(0)

    def test_monthly_comparison_matches_yearly_direction(
        self, client, stats_fixture
    ):
        response = client.get(
            '/api/v2/stats/monthly-comparison',
            headers=stats_fixture['owner_headers'],
        )

        assert response.status_code == 200
        payload = response.get_json()['data']
        assert payload['current_year'] == stats_fixture['current_year']
        assert payload['last_year'] == stats_fixture['previous_year']
        months = {row['month']: row for row in payload['months']}
        assert months['12']['last_year_expenses'] == pytest.approx(80)
        assert months['12']['last_year_deposits'] == pytest.approx(0)
        assert months['01']['current_year_deposits'] == pytest.approx(200)
        assert months['01']['current_year_expenses'] == pytest.approx(0)
        assert months['02']['current_year_expenses'] == pytest.approx(5)
        assert months['06']['current_year_deposits'] == pytest.approx(30)
        assert months['06']['current_year_expenses'] == pytest.approx(0)

    def test_account_stats_treat_received_share_payments_as_deposits(
        self, client, stats_fixture
    ):
        response = client.get(
            '/api/v2/stats/by-account',
            headers=stats_fixture['owner_headers'],
        )

        assert response.status_code == 200
        accounts = {row['account']: row for row in response.get_json()['data']}
        assert '' not in accounts
        assert None not in accounts
        checking = accounts['Checking']
        assert checking['expenses'] == pytest.approx(80)
        assert checking['deposits'] == pytest.approx(230)
        assert checking['total'] == pytest.approx(80 - 230)

        sharee = client.get(
            '/api/v2/stats/by-account',
            headers=stats_fixture['sharee_headers'],
        )
        assert sharee.status_code == 200
        sharee_accounts = {row['account']: row for row in sharee.get_json()['data']}
        assert sharee_accounts['Checking']['expenses'] == pytest.approx(30)
        assert sharee_accounts['Checking']['deposits'] == pytest.approx(0)

    def test_all_payments_keeps_share_direction_and_payment_date(
        self, client, stats_fixture
    ):
        owner = client.get('/api/v2/payments', headers=stats_fixture['owner_headers'])
        assert owner.status_code == 200
        owner_rows = owner.get_json()['data']
        received = next(
            row for row in owner_rows
            if row['payment_date'] == stats_fixture['dates']['current_june']
        )
        assert received['bill_type'] == 'deposit'
        assert received['is_received_payment'] is True
        assert received['amount'] == pytest.approx(30)
        boundary = next(
            row for row in owner_rows
            if row['payment_date'] == stats_fixture['dates']['previous_year_end']
        )
        assert boundary['bill_type'] == 'expense'
        assert boundary['amount'] == pytest.approx(80)

        sharee = client.get('/api/v2/payments', headers=stats_fixture['sharee_headers'])
        assert sharee.status_code == 200
        sharee_row = next(
            row for row in sharee.get_json()['data']
            if row['payment_date'] == stats_fixture['dates']['current_june']
        )
        assert sharee_row['bill_type'] == 'expense'
        assert sharee_row['is_received_payment'] is False
        assert sharee_row['amount'] == pytest.approx(30)

    def test_monthly_stats_count_shared_payment_once_when_sharee_can_access_owner_database(
        self, client, stats_fixture, db_session, regular_user, test_database
    ):
        """A sharee's payment is one expense, even if they can open the owner's database."""
        regular_user.accessible_databases.append(test_database)
        db_session.commit()

        month = f"{stats_fixture['current_year']}-06"
        owner = client.get('/api/v2/stats/monthly', headers=stats_fixture['owner_headers'])
        assert owner.status_code == 200
        owner_month = owner.get_json()['data'][month]
        assert owner_month['deposits'] == pytest.approx(30)
        assert owner_month['expenses'] == pytest.approx(0)

        own_database = client.get(
            '/api/v2/stats/monthly',
            headers=stats_fixture['sharee_headers'],
        )
        assert own_database.status_code == 200
        own_month = own_database.get_json()['data'][month]
        assert own_month['expenses'] == pytest.approx(30)
        assert own_month['deposits'] == pytest.approx(0)

        sharee_headers = stats_fixture['sharee_headers'].copy()
        sharee_headers['X-Database'] = test_database.name
        shared_access = client.get('/api/v2/stats/monthly', headers=sharee_headers)
        assert shared_access.status_code == 200
        shared_month = shared_access.get_json()['data'][month]
        assert shared_month['expenses'] == pytest.approx(30)
        assert shared_month['deposits'] == pytest.approx(0)
