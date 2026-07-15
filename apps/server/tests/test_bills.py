"""
Bills API tests for BillManager.

Tests:
- CRUD operations for bills
- Bill payment recording
- Archive/unarchive functionality
"""
import json
import datetime
import pytest

from models import Bill, BillShare, Database


class TestBillsCRUD:
    """Test bills CRUD operations via API v2."""

    def test_get_bills_empty(self, client, auth_headers_with_db):
        """Test getting bills when none exist."""
        response = client.get('/api/v2/bills', headers=auth_headers_with_db)
        assert response.status_code == 200
        data = json.loads(response.data)
        assert data.get('success') is True
        assert isinstance(data.get('data'), list)

    def test_create_bill(self, client, auth_headers_with_db):
        """Test creating a new bill."""
        response = client.post('/api/v2/bills',
                               headers=auth_headers_with_db,
                               json={
                                   'name': 'Electric Bill',
                                   'amount': 150.00,
                                   'frequency': 'monthly',
                                   'next_due': '2025-01-15',
                                   'type': 'expense',
                                   'account': 'Checking'
                               })
        assert response.status_code == 201
        data = json.loads(response.data)
        assert data.get('success') is True
        assert 'id' in data['data']

    def test_create_bill_missing_required_fields(self, client, auth_headers_with_db):
        """Test creating bill fails without required fields."""
        response = client.post('/api/v2/bills',
                               headers=auth_headers_with_db,
                               json={
                                   'name': 'Incomplete Bill'
                                   # Missing frequency and due_date
                               })
        assert response.status_code == 400

    def test_get_single_bill(self, client, auth_headers_with_db, test_bill):
        """Test getting a single bill by ID."""
        response = client.get(f'/api/v2/bills/{test_bill.id}',
                              headers=auth_headers_with_db)
        assert response.status_code == 200
        data = json.loads(response.data)
        assert data.get('success') is True
        assert data['data']['name'] == 'Test Bill'

    def test_update_bill(self, client, auth_headers_with_db, test_bill):
        """Test updating a bill."""
        response = client.put(f'/api/v2/bills/{test_bill.id}',
                              headers=auth_headers_with_db,
                              json={
                                  'name': 'Updated Bill Name',
                                  'amount': 200.00
                              })
        assert response.status_code == 200
        data = json.loads(response.data)
        assert data.get('success') is True
        # API returns message, verify by fetching the bill
        get_response = client.get(f'/api/v2/bills/{test_bill.id}',
                                  headers=auth_headers_with_db)
        get_data = json.loads(get_response.data)
        assert get_data['data']['name'] == 'Updated Bill Name'
        assert get_data['data']['amount'] == 200.00

    def test_archive_bill(self, client, auth_headers_with_db, test_bill):
        """Test archiving (soft delete) a bill."""
        response = client.delete(f'/api/v2/bills/{test_bill.id}',
                                 headers=auth_headers_with_db)
        assert response.status_code == 200
        data = json.loads(response.data)
        assert data.get('success') is True

    def test_unarchive_bill(self, client, auth_headers_with_db, test_bill, app, db_session):
        """Test unarchiving a bill."""
        # First archive it
        with app.app_context():
            test_bill.archived = True
            db_session.commit()

        # Then unarchive
        response = client.post(f'/api/v2/bills/{test_bill.id}/unarchive',
                               headers=auth_headers_with_db)
        assert response.status_code == 200

    def test_get_nonexistent_bill(self, client, auth_headers_with_db):
        """Test getting a bill that doesn't exist."""
        response = client.get('/api/v2/bills/99999',
                              headers=auth_headers_with_db)
        assert response.status_code == 404


class TestBillPayments:
    """Test bill payment operations."""

    def test_pay_bill(self, client, auth_headers_with_db, test_bill):
        """Test recording a payment for a bill."""
        response = client.post(f'/api/v2/bills/{test_bill.id}/pay',
                               headers=auth_headers_with_db,
                               json={
                                   'amount': 100.00,
                                   'payment_date': '2025-01-15'
                               })
        assert response.status_code in [200, 201]
        data = json.loads(response.data)
        assert data.get('success') is True

    def test_pay_bill_with_notes(self, client, auth_headers_with_db, test_bill):
        """Test recording a payment with notes."""
        response = client.post(f'/api/v2/bills/{test_bill.id}/pay',
                               headers=auth_headers_with_db,
                               json={
                                   'amount': 100.00,
                                   'payment_date': '2025-01-15',
                                   'notes': 'Paid via online banking'
                               })
        assert response.status_code in [200, 201]

    def test_get_bill_payments(self, client, auth_headers_with_db, test_bill):
        """Test getting payment history for a bill."""
        # First make a payment
        client.post(f'/api/v2/bills/{test_bill.id}/pay',
                    headers=auth_headers_with_db,
                    json={
                        'amount': 100.00,
                        'payment_date': '2025-01-15'
                    })

        # Get payments
        response = client.get(f'/api/v2/bills/{test_bill.id}/payments',
                              headers=auth_headers_with_db)
        assert response.status_code == 200
        data = json.loads(response.data)
        assert data.get('success') is True
        assert isinstance(data.get('data'), list)
        assert len(data['data']) >= 1


class TestBillTypes:
    """Test different bill types (expense vs deposit)."""

    def test_create_expense_bill(self, client, auth_headers_with_db):
        """Test creating an expense bill."""
        response = client.post('/api/v2/bills',
                               headers=auth_headers_with_db,
                               json={
                                   'name': 'Rent',
                                   'amount': 1500.00,
                                   'frequency': 'monthly',
                                   'next_due': '2025-01-01',
                                   'type': 'expense'
                               })
        assert response.status_code == 201
        data = json.loads(response.data)
        assert 'id' in data['data']
        # Verify by fetching
        bill_id = data['data']['id']
        get_resp = client.get(f'/api/v2/bills/{bill_id}', headers=auth_headers_with_db)
        get_data = json.loads(get_resp.data)
        assert get_data['data']['type'] == 'expense'

    def test_create_deposit_bill(self, client, auth_headers_with_db):
        """Test creating a deposit (income) bill."""
        response = client.post('/api/v2/bills',
                               headers=auth_headers_with_db,
                               json={
                                   'name': 'Salary',
                                   'amount': 5000.00,
                                   'frequency': 'monthly',
                                   'next_due': '2025-01-15',
                                   'type': 'deposit'
                               })
        assert response.status_code == 201
        data = json.loads(response.data)
        assert 'id' in data['data']
        # Verify by fetching
        bill_id = data['data']['id']
        get_resp = client.get(f'/api/v2/bills/{bill_id}', headers=auth_headers_with_db)
        get_data = json.loads(get_resp.data)
        assert get_data['data']['type'] == 'deposit'

    def test_create_variable_amount_bill(self, client, auth_headers_with_db):
        """Test creating a bill with variable amount."""
        response = client.post('/api/v2/bills',
                               headers=auth_headers_with_db,
                               json={
                                   'name': 'Water Bill',
                                   'varies': True,
                                   'frequency': 'monthly',
                                   'next_due': '2025-01-20',
                                   'type': 'expense'
                               })
        assert response.status_code == 201
        data = json.loads(response.data)
        assert 'id' in data['data']
        # Verify by fetching
        bill_id = data['data']['id']
        get_resp = client.get(f'/api/v2/bills/{bill_id}', headers=auth_headers_with_db)
        get_data = json.loads(get_resp.data)
        assert get_data['data']['varies'] is True


class TestBillCategoriesAndBudgets:
    """Test bill categories and monthly category budgets."""

    def test_create_and_update_bill_category_and_notes(self, client, auth_headers_with_db):
        """Test categories and notes persist through bill CRUD."""
        response = client.post('/api/v2/bills',
                               headers=auth_headers_with_db,
                               json={
                                   'name': 'Internet',
                                   'amount': 80.00,
                                   'frequency': 'monthly',
                                   'next_due': '2025-01-15',
                                   'type': 'expense',
                                   'account': 'Checking',
                                   'category': 'Utilities',
                                   'notes': 'Fiber plan'
                               })
        assert response.status_code == 201
        bill_id = json.loads(response.data)['data']['id']

        get_response = client.get(f'/api/v2/bills/{bill_id}', headers=auth_headers_with_db)
        get_data = json.loads(get_response.data)
        assert get_data['data']['category'] == 'Utilities'
        assert get_data['data']['notes'] == 'Fiber plan'

        update_response = client.put(f'/api/v2/bills/{bill_id}',
                                     headers=auth_headers_with_db,
                                     json={'category': 'Subscriptions', 'notes': 'Promotional rate'})
        assert update_response.status_code == 200

        get_response = client.get(f'/api/v2/bills/{bill_id}', headers=auth_headers_with_db)
        get_data = json.loads(get_response.data)
        assert get_data['data']['category'] == 'Subscriptions'
        assert get_data['data']['notes'] == 'Promotional rate'

    def test_get_categories_includes_bill_categories_only(self, client, auth_headers_with_db):
        """Test category discovery includes entered bill categories without budget-only values."""
        bill_response = client.post('/api/v2/bills',
                                    headers=auth_headers_with_db,
                                    json={
                                        'name': 'Water',
                                        'amount': 45.00,
                                        'frequency': 'monthly',
                                        'next_due': '2025-01-20',
                                        'type': 'expense',
                                        'category': 'Utilities'
                                    })
        assert bill_response.status_code == 201

        budget_response = client.post('/api/v2/budgets',
                                      headers=auth_headers_with_db,
                                      json={'category': 'Groceries', 'monthly_limit': 600})
        assert budget_response.status_code == 201

        response = client.get('/api/v2/categories', headers=auth_headers_with_db)
        assert response.status_code == 200
        data = json.loads(response.data)
        assert 'Utilities' in data['data']
        assert 'Groceries' not in data['data']

    def test_budget_crud_and_monthly_summary(self, client, auth_headers_with_db):
        """Test creating, updating, summarizing, and deleting category budgets."""
        bill_response = client.post('/api/v2/bills',
                                    headers=auth_headers_with_db,
                                    json={
                                        'name': 'Electric',
                                        'amount': 125.00,
                                        'frequency': 'monthly',
                                        'next_due': '2025-01-10',
                                        'type': 'expense',
                                        'category': 'Utilities'
                                    })
        assert bill_response.status_code == 201
        bill_id = json.loads(bill_response.data)['data']['id']

        pay_response = client.post(f'/api/v2/bills/{bill_id}/pay',
                                   headers=auth_headers_with_db,
                                   json={
                                       'amount': 125.00,
                                       'payment_date': '2025-01-10',
                                       'advance_due': False
                                   })
        assert pay_response.status_code in [200, 201]

        budget_response = client.post('/api/v2/budgets',
                                      headers=auth_headers_with_db,
                                      json={'category': 'Utilities', 'monthly_limit': 200})
        assert budget_response.status_code == 201
        budget = json.loads(budget_response.data)['data']

        list_response = client.get('/api/v2/budgets', headers=auth_headers_with_db)
        assert list_response.status_code == 200
        list_data = json.loads(list_response.data)
        assert list_data['data'][0]['category'] == 'Utilities'

        summary_response = client.get('/api/v2/budgets/summary?month=2025-01',
                                      headers=auth_headers_with_db)
        assert summary_response.status_code == 200
        summary_data = json.loads(summary_response.data)['data']
        utilities = next(item for item in summary_data if item['category'] == 'Utilities')
        assert utilities['monthly_limit'] == 200
        assert utilities['spent'] == 125
        assert utilities['remaining'] == 75
        assert utilities['over_budget'] is False

        update_response = client.put(f"/api/v2/budgets/{budget['id']}",
                                     headers=auth_headers_with_db,
                                     json={'monthly_limit': 100})
        assert update_response.status_code == 200

        summary_response = client.get('/api/v2/budgets/summary?month=2025-01',
                                      headers=auth_headers_with_db)
        summary_data = json.loads(summary_response.data)['data']
        utilities = next(item for item in summary_data if item['category'] == 'Utilities')
        assert utilities['over_budget'] is True

        delete_response = client.delete(f"/api/v2/budgets/{budget['id']}",
                                        headers=auth_headers_with_db)
        assert delete_response.status_code == 200


class TestBillReminderAlerts:
    """Test per-bill reminder preferences and alert generation."""

    def test_create_bill_with_reminder_preferences(self, client, auth_headers_with_db):
        """Test reminder settings persist on bills."""
        response = client.post('/api/v2/bills',
                               headers=auth_headers_with_db,
                               json={
                                   'name': 'Car Insurance',
                                   'amount': 140.00,
                                   'frequency': 'monthly',
                                   'next_due': '2025-02-01',
                                   'type': 'expense',
                                   'reminder_enabled': True,
                                   'reminder_days': [1, 7, 14]
                               })
        assert response.status_code == 201
        bill_id = json.loads(response.data)['data']['id']

        get_response = client.get(f'/api/v2/bills/{bill_id}', headers=auth_headers_with_db)
        get_data = json.loads(get_response.data)
        assert get_data['data']['reminder_enabled'] is True
        assert get_data['data']['reminder_days'] == [1, 7, 14]

        update_response = client.put(f'/api/v2/bills/{bill_id}',
                                     headers=auth_headers_with_db,
                                     json={
                                         'reminder_enabled': False,
                                         'reminder_days': [0, 3]
                                     })
        assert update_response.status_code == 200

        get_response = client.get(f'/api/v2/bills/{bill_id}', headers=auth_headers_with_db)
        get_data = json.loads(get_response.data)
        assert get_data['data']['reminder_enabled'] is False
        assert get_data['data']['reminder_days'] == [0, 3]

    def test_invalid_reminder_days_rejected(self, client, auth_headers_with_db):
        """Test unsupported reminder offsets are rejected."""
        response = client.post('/api/v2/bills',
                               headers=auth_headers_with_db,
                               json={
                                   'name': 'Invalid Reminder',
                                   'amount': 10.00,
                                   'frequency': 'monthly',
                                   'next_due': '2025-02-01',
                                   'type': 'expense',
                                   'reminder_days': [2]
                               })
        assert response.status_code == 400
        data = json.loads(response.data)
        assert data['error'] == 'Invalid reminder_days value'
        assert 'one of' not in data['error']

    def test_invalid_reminder_days_update_rejected_without_exception_detail(
        self, client, auth_headers_with_db, test_bill
    ):
        """Test invalid reminder update errors do not expose exception details."""
        response = client.put(f'/api/v2/bills/{test_bill.id}',
                              headers=auth_headers_with_db,
                              json={'reminder_days': ['not-a-number']})
        assert response.status_code == 400
        data = json.loads(response.data)
        assert data['error'] == 'Invalid reminder_days value'
        assert 'whole numbers' not in data['error']

    def test_upcoming_alerts_include_overdue_and_configured_windows(self, client, auth_headers_with_db):
        """Test reminder alert endpoint honors reminder windows."""
        today = datetime.date.today()
        overdue = (today - datetime.timedelta(days=1)).isoformat()
        due_in_three = (today + datetime.timedelta(days=3)).isoformat()
        due_in_seven = (today + datetime.timedelta(days=7)).isoformat()

        overdue_response = client.post('/api/v2/bills',
                                       headers=auth_headers_with_db,
                                       json={
                                           'name': 'Overdue Rent',
                                           'amount': 1200.00,
                                           'frequency': 'monthly',
                                           'next_due': overdue,
                                           'type': 'expense',
                                           'reminder_enabled': False,
                                       })
        assert overdue_response.status_code == 201

        configured_response = client.post('/api/v2/bills',
                                          headers=auth_headers_with_db,
                                          json={
                                              'name': 'Configured Utility',
                                              'amount': 90.00,
                                              'frequency': 'monthly',
                                              'next_due': due_in_three,
                                              'type': 'expense',
                                              'reminder_days': [3],
                                          })
        assert configured_response.status_code == 201

        muted_response = client.post('/api/v2/bills',
                                     headers=auth_headers_with_db,
                                     json={
                                         'name': 'Muted Subscription',
                                         'amount': 20.00,
                                         'frequency': 'monthly',
                                         'next_due': due_in_seven,
                                         'type': 'expense',
                                         'reminder_days': [3],
                                     })
        assert muted_response.status_code == 201

        response = client.get('/api/v2/alerts/upcoming?horizon_days=10',
                              headers=auth_headers_with_db)
        assert response.status_code == 200
        alerts = json.loads(response.data)['data']
        alert_names = {alert['bill_name'] for alert in alerts}
        assert 'Overdue Rent' in alert_names
        assert 'Configured Utility' in alert_names
        assert 'Muted Subscription' not in alert_names


class TestBillSettlements:
    """Test shared-bill settlement summaries."""

    def _create_recipient_database(self, db_session, regular_user):
        database = Database(
            name='recipientdb',
            display_name='Recipient Database',
            description='Database for settlement recipient tests',
            owner_id=regular_user.id
        )
        db_session.add(database)
        db_session.commit()
        regular_user.accessible_databases.append(database)
        db_session.commit()
        return database

    def _create_accepted_share(self, db_session, test_bill, admin_user, regular_user, split_type='equal', split_value=None):
        share = BillShare(
            bill_id=test_bill.id,
            owner_user_id=admin_user.id,
            shared_with_user_id=regular_user.id,
            shared_with_identifier=regular_user.username,
            identifier_type='username',
            status='accepted',
            split_type=split_type,
            split_value=split_value,
            accepted_at=datetime.datetime.now(datetime.timezone.utc)
        )
        db_session.add(share)
        db_session.commit()
        db_session.refresh(share)
        return share

    def test_settlements_show_owner_receivable_and_recipient_payable(
        self,
        client,
        auth_headers_with_db,
        user_auth_headers,
        db_session,
        test_bill,
        admin_user,
        regular_user,
    ):
        """Test open shared balances appear from both user perspectives."""
        recipient_db = self._create_recipient_database(db_session, regular_user)
        self._create_accepted_share(db_session, test_bill, admin_user, regular_user)

        owner_response = client.get('/api/v2/settlements', headers=auth_headers_with_db)
        assert owner_response.status_code == 200
        owner_data = json.loads(owner_response.data)['data']
        assert owner_data['summary']['owed_to_me'] == 50
        assert owner_data['summary']['i_owe'] == 0
        assert owner_data['owed_to_me'][0]['counterparty_name'] == regular_user.username
        assert owner_data['owed_to_me'][0]['amount'] == 50

        recipient_headers = user_auth_headers.copy()
        recipient_headers['X-Database'] = recipient_db.name
        recipient_response = client.get('/api/v2/settlements', headers=recipient_headers)
        assert recipient_response.status_code == 200
        recipient_data = json.loads(recipient_response.data)['data']
        assert recipient_data['summary']['owed_to_me'] == 0
        assert recipient_data['summary']['i_owe'] == 50
        assert recipient_data['i_owe'][0]['counterparty_name'] == admin_user.username

    def test_mark_share_paid_moves_settlement_to_settled(
        self,
        client,
        auth_headers_with_db,
        user_auth_headers,
        db_session,
        test_bill,
        admin_user,
        regular_user,
    ):
        """Test paid shares leave open balances and appear in recent settled rows."""
        recipient_db = self._create_recipient_database(db_session, regular_user)
        share = self._create_accepted_share(
            db_session,
            test_bill,
            admin_user,
            regular_user,
            split_type='fixed',
            split_value=30
        )

        recipient_headers = user_auth_headers.copy()
        recipient_headers['X-Database'] = recipient_db.name
        mark_response = client.post(f'/api/v2/shares/{share.id}/mark-paid',
                                    headers=recipient_headers)
        assert mark_response.status_code == 200

        owner_response = client.get('/api/v2/settlements', headers=auth_headers_with_db)
        owner_data = json.loads(owner_response.data)['data']
        assert owner_data['summary']['owed_to_me'] == 0
        assert owner_data['summary']['settled_count'] == 1
        assert owner_data['settled'][0]['direction'] == 'owed_to_me'
        assert owner_data['settled'][0]['amount'] == 30

        recipient_response = client.get('/api/v2/settlements', headers=recipient_headers)
        recipient_data = json.loads(recipient_response.data)['data']
        assert recipient_data['summary']['i_owe'] == 0
        assert recipient_data['summary']['settled_count'] == 1
        assert recipient_data['settled'][0]['direction'] == 'i_owe'


class TestCashFlowForecast:
    """Test cash-flow forecast projections."""

    def _create_recipient_database(self, db_session, regular_user):
        database = Database(
            name='recipientdb',
            display_name='Recipient Database',
            description='Database for forecast recipient tests',
            owner_id=regular_user.id
        )
        db_session.add(database)
        db_session.commit()
        regular_user.accessible_databases.append(database)
        db_session.commit()
        return database

    def test_cash_flow_forecast_projects_owned_expenses_and_deposits(
        self,
        client,
        auth_headers_with_db,
    ):
        """Test owned recurring expenses and deposits affect projected balance."""
        today = datetime.date.today()
        in_ten_days = (today + datetime.timedelta(days=10)).isoformat()

        rent_response = client.post('/api/v2/bills',
                                    headers=auth_headers_with_db,
                                    json={
                                        'name': 'Rent Forecast',
                                        'amount': 100.00,
                                        'frequency': 'monthly',
                                        'next_due': today.isoformat(),
                                        'type': 'expense'
                                    })
        assert rent_response.status_code == 201

        salary_response = client.post('/api/v2/bills',
                                      headers=auth_headers_with_db,
                                      json={
                                          'name': 'Salary Forecast',
                                          'amount': 500.00,
                                          'frequency': 'monthly',
                                          'next_due': in_ten_days,
                                          'type': 'deposit'
                                      })
        assert salary_response.status_code == 201

        response = client.get('/api/v2/forecast/cash-flow?starting_balance=1000&days=20',
                              headers=auth_headers_with_db)
        assert response.status_code == 200
        forecast = json.loads(response.data)['data']
        assert forecast['summary']['total_expenses'] == 100
        assert forecast['summary']['total_income'] == 500
        assert forecast['summary']['ending_balance'] == 1400
        assert forecast['summary']['runway_days'] is None
        assert len(forecast['daily']) == 21

    def test_cash_flow_forecast_includes_shared_payables(
        self,
        client,
        user_auth_headers,
        db_session,
        test_database,
        admin_user,
        regular_user,
    ):
        """Test accepted shared bills are projected at the recipient's portion."""
        today = datetime.date.today().isoformat()
        bill = Bill(
            database_id=test_database.id,
            name='Shared Forecast Bill',
            amount=100.00,
            frequency='monthly',
            due_date=today,
            type='expense',
            account='Checking'
        )
        db_session.add(bill)
        db_session.commit()
        db_session.refresh(bill)

        share = BillShare(
            bill_id=bill.id,
            owner_user_id=admin_user.id,
            shared_with_user_id=regular_user.id,
            shared_with_identifier=regular_user.username,
            identifier_type='username',
            status='accepted',
            split_type='equal',
            accepted_at=datetime.datetime.now(datetime.timezone.utc)
        )
        db_session.add(share)
        db_session.commit()

        recipient_db = self._create_recipient_database(db_session, regular_user)
        recipient_headers = user_auth_headers.copy()
        recipient_headers['X-Database'] = recipient_db.name

        response = client.get('/api/v2/forecast/cash-flow?starting_balance=100&days=7',
                              headers=recipient_headers)
        assert response.status_code == 200
        forecast = json.loads(response.data)['data']
        assert forecast['summary']['total_expenses'] == 50
        assert forecast['summary']['ending_balance'] == 50
        assert forecast['occurrences'][0]['source'] == 'shared'
        assert forecast['occurrences'][0]['amount'] == 50


class TestBillValidation:
    """Test bill input validation."""

    def test_invalid_frequency(self, client, auth_headers_with_db):
        """Test that invalid frequency is rejected."""
        response = client.post('/api/v2/bills',
                               headers=auth_headers_with_db,
                               json={
                                   'name': 'Test Bill',
                                   'amount': 100.00,
                                   'frequency': 'invalid_frequency',
                                   'due_date': '2025-01-15'
                               })
        assert response.status_code == 400

    def test_invalid_date_format(self, client, auth_headers_with_db):
        """Test that invalid date format is rejected."""
        response = client.post('/api/v2/bills',
                               headers=auth_headers_with_db,
                               json={
                                   'name': 'Test Bill',
                                   'amount': 100.00,
                                   'frequency': 'monthly',
                                   'due_date': 'not-a-date'
                               })
        assert response.status_code == 400

    def test_negative_amount(self, client, auth_headers_with_db):
        """Test that negative amounts are handled."""
        response = client.post('/api/v2/bills',
                               headers=auth_headers_with_db,
                               json={
                                   'name': 'Test Bill',
                                   'amount': -100.00,
                                   'frequency': 'monthly',
                                   'due_date': '2025-01-15'
                               })
        # Should either reject or handle appropriately
        assert response.status_code in [400, 201]


class TestBillShareCreation:
    """Regression coverage for POST /bills/<id>/share request field names.

    The web and mobile clients both send `identifier` (username or email),
    matching the v1 session-based route. The v2 route had drifted to expect
    `shared_with` instead, silently rejecting every share request from both
    clients with "identifier is required".
    """

    def test_share_by_username_accepts_identifier_field(
        self, client, auth_headers_with_db, test_bill, regular_user
    ):
        response = client.post(
            f'/api/v2/bills/{test_bill.id}/share',
            headers=auth_headers_with_db,
            json={'identifier': regular_user.username},
        )
        assert response.status_code == 201
        data = json.loads(response.data)
        assert data['success'] is True
        assert data['data']['shared_with_identifier'] == regular_user.username

    def test_share_missing_identifier_is_rejected(self, client, auth_headers_with_db, test_bill):
        response = client.post(
            f'/api/v2/bills/{test_bill.id}/share',
            headers=auth_headers_with_db,
            json={},
        )
        assert response.status_code == 400
        data = json.loads(response.data)
        assert 'identifier' in data['error']
