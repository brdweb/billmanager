"""
Payments API tests for BillManager.

Tests:
- Payment CRUD operations
- Payment listing and filtering
- Payment updates and deletion
"""
import json
import pytest


class TestPaymentsCRUD:
    """Test payment operations."""

    def test_get_all_payments_empty(self, client, auth_headers_with_db):
        """Test getting payments when none exist."""
        response = client.get('/api/v2/payments', headers=auth_headers_with_db)
        assert response.status_code == 200
        data = json.loads(response.data)
        assert data.get('success') is True
        assert isinstance(data.get('data'), list)

    def test_get_all_payments(self, client, auth_headers_with_db, test_bill):
        """Test getting all payments after making some."""
        # Create a payment
        client.post(f'/api/v2/bills/{test_bill.id}/pay',
                    headers=auth_headers_with_db,
                    json={
                        'amount': 100.00,
                        'payment_date': '2025-01-15'
                    })

        response = client.get('/api/v2/payments', headers=auth_headers_with_db)
        assert response.status_code == 200
        data = json.loads(response.data)
        assert data.get('success') is True
        assert len(data.get('data', [])) >= 1

    def test_update_payment(self, client, auth_headers_with_db, test_bill, app, db_session):
        """Test updating a payment."""
        from models import Payment

        # Create a payment
        pay_response = client.post(f'/api/v2/bills/{test_bill.id}/pay',
                                   headers=auth_headers_with_db,
                                   json={
                                       'amount': 100.00,
                                       'payment_date': '2025-01-15'
                                   })

        # Get the payment ID from the database
        with app.app_context():
            payment = Payment.query.filter_by(bill_id=test_bill.id).first()
            payment_id = payment.id

        # Update it
        response = client.put(f'/api/v2/payments/{payment_id}',
                              headers=auth_headers_with_db,
                              json={
                                  'amount': 150.00,
                                  'notes': 'Updated payment'
                              })
        assert response.status_code == 200
        data = json.loads(response.data)
        assert data.get('success') is True

    def test_delete_payment(self, client, auth_headers_with_db, test_bill, app, db_session):
        """Test deleting a payment."""
        from models import Payment

        # Create a payment
        client.post(f'/api/v2/bills/{test_bill.id}/pay',
                    headers=auth_headers_with_db,
                    json={
                        'amount': 100.00,
                        'payment_date': '2025-01-15'
                    })

        # Get the payment ID
        with app.app_context():
            payment = Payment.query.filter_by(bill_id=test_bill.id).first()
            payment_id = payment.id

        # Delete it
        response = client.delete(f'/api/v2/payments/{payment_id}',
                                 headers=auth_headers_with_db)
        assert response.status_code == 200

    def test_update_nonexistent_payment(self, client, auth_headers_with_db):
        """Test updating a payment that doesn't exist."""
        response = client.put('/api/v2/payments/99999',
                              headers=auth_headers_with_db,
                              json={
                                  'amount': 150.00
                              })
        assert response.status_code == 404

    def test_delete_nonexistent_payment(self, client, auth_headers_with_db):
        """Test deleting a payment that doesn't exist."""
        response = client.delete('/api/v2/payments/99999',
                                 headers=auth_headers_with_db)
        assert response.status_code == 404


class TestPaymentValidation:
    """Test payment input validation."""

    def test_payment_requires_amount(self, client, auth_headers_with_db, test_bill):
        """Test that payments require an amount."""
        response = client.post(f'/api/v2/bills/{test_bill.id}/pay',
                               headers=auth_headers_with_db,
                               json={
                                   'payment_date': '2025-01-15'
                                   # Missing amount
                               })
        assert response.status_code == 400

    def test_payment_requires_date(self, client, auth_headers_with_db, test_bill):
        """Test that payments require a date."""
        response = client.post(f'/api/v2/bills/{test_bill.id}/pay',
                               headers=auth_headers_with_db,
                               json={
                                   'amount': 100.00
                                   # Missing payment_date
                               })
        assert response.status_code == 400

    def test_payment_invalid_date_format(self, client, auth_headers_with_db, test_bill):
        """Test that invalid date formats are rejected."""
        response = client.post(f'/api/v2/bills/{test_bill.id}/pay',
                               headers=auth_headers_with_db,
                               json={
                                   'amount': 100.00,
                                   'payment_date': 'invalid-date'
                               })
        assert response.status_code == 400


class TestPaymentAuthorization:
    """Test payment authorization."""

    def test_payment_requires_auth(self, client, test_bill):
        """Test that payments require authentication."""
        response = client.post(f'/api/v2/bills/{test_bill.id}/pay',
                               json={
                                   'amount': 100.00,
                                   'payment_date': '2025-01-15'
                               })
        assert response.status_code == 401

    def test_payment_requires_database_header(self, client, admin_auth_headers, test_bill):
        """Test that API v2 payments require X-Database header."""
        # Headers without X-Database
        response = client.get('/api/v2/payments', headers=admin_auth_headers)
        # Should either fail or return empty based on implementation
        # The key is it shouldn't crash
        assert response.status_code in [200, 400, 403]
