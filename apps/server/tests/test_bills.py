"""
Bills API tests for BillManager.

Tests:
- CRUD operations for bills
- Bill payment recording
- Archive/unarchive functionality
"""
import json
import pytest


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
                                   'due_date': '2025-01-15',
                                   'type': 'expense',
                                   'account': 'Checking'
                               })
        assert response.status_code == 201
        data = json.loads(response.data)
        assert data.get('success') is True
        assert data['data']['name'] == 'Electric Bill'
        assert data['data']['amount'] == 150.00

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
        assert data['data']['name'] == 'Updated Bill Name'
        assert data['data']['amount'] == 200.00

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
                                   'due_date': '2025-01-01',
                                   'type': 'expense'
                               })
        assert response.status_code == 201
        data = json.loads(response.data)
        assert data['data']['type'] == 'expense'

    def test_create_deposit_bill(self, client, auth_headers_with_db):
        """Test creating a deposit (income) bill."""
        response = client.post('/api/v2/bills',
                               headers=auth_headers_with_db,
                               json={
                                   'name': 'Salary',
                                   'amount': 5000.00,
                                   'frequency': 'monthly',
                                   'due_date': '2025-01-15',
                                   'type': 'deposit'
                               })
        assert response.status_code == 201
        data = json.loads(response.data)
        assert data['data']['type'] == 'deposit'

    def test_create_variable_amount_bill(self, client, auth_headers_with_db):
        """Test creating a bill with variable amount."""
        response = client.post('/api/v2/bills',
                               headers=auth_headers_with_db,
                               json={
                                   'name': 'Water Bill',
                                   'is_variable': True,
                                   'frequency': 'monthly',
                                   'due_date': '2025-01-20',
                                   'type': 'expense'
                               })
        assert response.status_code == 201
        data = json.loads(response.data)
        assert data['data']['is_variable'] is True


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
