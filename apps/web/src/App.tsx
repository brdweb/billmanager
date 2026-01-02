import { useState, useEffect, useCallback, useMemo } from 'react';
import { Stack, Loader, Center, Divider, Text, Anchor } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { Routes, Route, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Sidebar } from './components/Sidebar';
import { BillList } from './components/BillList';
import { BillModal } from './components/BillModal';
import { PayModal } from './components/PayModal';
import { PaymentHistory } from './components/PaymentHistory';
import { Calendar } from './components/Calendar';
import { PasswordChangeModal } from './components/PasswordChangeModal';
import { AdminModal } from './components/AdminPanel/AdminModal';
import { MonthlyTotalsChart } from './components/MonthlyTotalsChart';
import { AllPayments } from './pages/AllPayments';
import { Login } from './pages/Login';
import { VerifyEmail } from './pages/VerifyEmail';
import { ForgotPassword } from './pages/ForgotPassword';
import { ResetPassword } from './pages/ResetPassword';
import { ResendVerification } from './pages/ResendVerification';
import { AcceptInvite } from './pages/AcceptInvite';
import { Billing } from './pages/Billing';
import { useAuth } from './context/AuthContext';
import { useConfig } from './context/ConfigContext';
import * as api from './api/client';
import type { Bill } from './api/client';
import { archiveBill, unarchiveBill, deleteBillPermanent } from './api/client';

// Filter types
export type DateRangeFilter = 'all' | 'overdue' | 'thisWeek' | 'nextWeek' | 'next21Days' | 'next30Days';

export interface BillFilter {
  searchQuery: string;
  dateRange: DateRangeFilter;
  selectedDate: string | null; // YYYY-MM-DD format
  type: 'all' | 'expense' | 'deposit';
  account: string | null;
}

function App() {
  const { isLoggedIn, isLoading, pendingPasswordChange, currentDb } = useAuth();
  const { config } = useConfig();
  const navigate = useNavigate();
  const location = useLocation();

  // Check if billing is enabled (defaults to false if config not loaded)
  const billingEnabled = config?.billing_enabled ?? false;

  // Bills state
  const [bills, setBills] = useState<Bill[]>([]);
  const [billsLoading, setBillsLoading] = useState(false);

  // Filter state
  const [filter, setFilter] = useState<BillFilter>({
    searchQuery: '',
    dateRange: 'all',
    selectedDate: null,
    type: 'all',
    account: null,
  });

  // Modal states
  const [adminOpened, { open: openAdmin, close: closeAdmin }] = useDisclosure(false);
  const [billModalOpened, { open: openBillModal, close: closeBillModal }] = useDisclosure(false);
  const [payModalOpened, { open: openPayModal, close: closePayModal }] = useDisclosure(false);
  const [historyOpened, { open: openHistory, close: closeHistory }] = useDisclosure(false);
  const [chartOpened, { open: openChart, close: closeChart }] = useDisclosure(false);

  // Current editing/paying bill
  const [currentBill, setCurrentBill] = useState<Bill | null>(null);
  const [historyBillId, setHistoryBillId] = useState<number | null>(null);
  const [historyBillName, setHistoryBillName] = useState<string | null>(null);

  // Filtered bills based on current filter
  const filteredBills = useMemo(() => {
    let result = bills;

    // Apply search query filter - if searching, include archived bills, otherwise hide them
    if (filter.searchQuery.trim()) {
      const query = filter.searchQuery.toLowerCase();
      result = result.filter((bill) => {
        const nameMatch = bill.name.toLowerCase().includes(query);
        const amountMatch = bill.amount?.toString().includes(query);
        const dateMatch = bill.next_due.includes(query);
        return nameMatch || amountMatch || dateMatch;
      });
    } else {
      // When not searching, hide archived bills
      result = result.filter((bill) => !bill.archived);
    }

    // Apply type filter
    if (filter.type !== 'all') {
      result = result.filter((bill) => bill.type === filter.type);
    }

    // Apply account filter
    if (filter.account) {
      result = result.filter((bill) => bill.account === filter.account);
    }

    // Apply date range filter
    if (filter.dateRange !== 'all') {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const oneDay = 24 * 60 * 60 * 1000;

      // Special handling for overdue filter
      if (filter.dateRange === 'overdue') {
        result = result.filter((bill) => {
          // Parse date directly to avoid timezone issues
          const [year, month, day] = bill.next_due.split('-').map(Number);
          const dueDate = new Date(year, month - 1, day);
          dueDate.setHours(0, 0, 0, 0);
          return dueDate < today;
        });
      } else {
        let startDate = today;
        let endDate: Date;

        switch (filter.dateRange) {
          case 'thisWeek':
            endDate = new Date(today.getTime() + 7 * oneDay);
            break;
          case 'nextWeek':
            startDate = new Date(today.getTime() + 7 * oneDay);
            endDate = new Date(today.getTime() + 14 * oneDay);
            break;
          case 'next21Days':
            endDate = new Date(today.getTime() + 21 * oneDay);
            break;
          case 'next30Days':
            endDate = new Date(today.getTime() + 30 * oneDay);
            break;
          default:
            endDate = new Date(today.getTime() + 365 * oneDay);
        }

        result = result.filter((bill) => {
          // Parse date directly to avoid timezone issues
          const [year, month, day] = bill.next_due.split('-').map(Number);
          const dueDate = new Date(year, month - 1, day);
          dueDate.setHours(0, 0, 0, 0);
          return dueDate >= startDate && dueDate < endDate;
        });
      }
    }

    // Apply specific date filter
    if (filter.selectedDate) {
      result = result.filter((bill) => bill.next_due === filter.selectedDate);
    }

    return result;
  }, [bills, filter]);

  // Fetch bills
  const fetchBills = useCallback(async () => {
    if (!isLoggedIn || !currentDb) {
      setBills([]);
      return;
    }

    setBillsLoading(true);
    try {
      // Process auto-payments first
      await api.processAutoPayments();
      // Then fetch bills (include archived so they can be searched)
      const response = await api.getBills(true);
      setBills(response);
    } catch (error) {
      console.error('Failed to fetch bills:', error);
      setBills([]);
    } finally {
      setBillsLoading(false);
    }
  }, [isLoggedIn, currentDb]);

  // Fetch bills when logged in or database changes
  useEffect(() => {
    fetchBills();
  }, [fetchBills]);

  // Handle password change required - derive directly from auth state
  const passwordChangeOpened = !!pendingPasswordChange;

  // Bill actions
  const handleAddBill = () => {
    setCurrentBill(null);
    openBillModal();
  };

  const handleEditBill = (bill: Bill) => {
    setCurrentBill(bill);
    openBillModal();
  };

  const handlePayBill = (bill: Bill) => {
    setCurrentBill(bill);
    openPayModal();
  };

  const handleViewPayments = (bill: Bill) => {
    setHistoryBillId(bill.id);
    setHistoryBillName(bill.name);
    openHistory();
  };

  const handleSaveBill = async (billData: Partial<Bill>) => {
    if (currentBill) {
      await api.updateBill(currentBill.id, billData);
    } else {
      await api.addBill(billData);
    }
    await fetchBills();
  };

  const handleArchiveBill = async (bill: Bill) => {
    await archiveBill(bill.id);
    await fetchBills();
  };

  const handleDeleteBill = async (bill: Bill) => {
    await deleteBillPermanent(bill.id);
    await fetchBills();
  };

  const handleUnarchiveBill = async (bill: Bill) => {
    await unarchiveBill(bill.id);
    await fetchBills();
  };

  const handlePay = async (amount: number, advanceDue: boolean) => {
    if (!currentBill) return;
    await api.payBill(currentBill.id, amount, advanceDue);
    await fetchBills();
  };

  if (isLoading) {
    return (
      <Center h="100vh">
        <Loader size="xl" />
      </Center>
    );
  }

  // Public routes - no authentication required
  const publicRoutes = ['/login', '/register', '/verify-email', '/forgot-password', '/reset-password', '/resend-verification', '/accept-invite'];
  const isPublicRoute = publicRoutes.includes(location.pathname);

  // If not logged in and not on a public route, render just the routes (no Layout)
  if (!isLoggedIn && !isLoading && !isPublicRoute) {
    return <Navigate to="/login" replace />;
  }

  // If logged in and on login page, redirect to home
  if (isLoggedIn && location.pathname === '/login') {
    return <Navigate to="/" replace />;
  }

  // Render public routes without Layout
  if (isPublicRoute) {
    return (
      <>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Login />} />
          <Route path="/verify-email" element={<VerifyEmail />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/resend-verification" element={<ResendVerification />} />
          <Route path="/accept-invite" element={<AcceptInvite />} />
        </Routes>
        {/* Password change modal must be accessible from login page */}
        <PasswordChangeModal
          opened={passwordChangeOpened}
          onClose={() => {}}
        />
      </>
    );
  }

  return (
    <>
      <Layout
        onAdminClick={openAdmin}
        onBillingClick={billingEnabled ? () => navigate('/billing') : undefined}
        sidebar={
          <Stack gap="xs">
            <Sidebar
              bills={bills}
              isLoggedIn={isLoggedIn}
              filter={filter}
              onFilterChange={setFilter}
              onShowChart={openChart}
              onShowAllPayments={() => navigate('/all-payments')}
            />
            {isLoggedIn && (
              <>
                <Calendar
                  bills={bills}
                  selectedDate={filter.selectedDate}
                  onDateSelect={(date) =>
                    setFilter((prev) => ({
                      ...prev,
                      selectedDate: date === prev.selectedDate ? null : date,
                      dateRange: 'all', // Clear date range when specific date selected
                    }))
                  }
                />
                <Divider />
                <Text size="xs" c="dimmed" ta="center">
                  BillManager v3.4.3 - Licensed under{' '}
                  <Anchor href="https://osaasy.dev/" target="_blank" size="xs">
                    O'Saasy
                  </Anchor>
                </Text>
              </>
            )}
          </Stack>
        }
      >
        <Routes>
          <Route
            path="/"
            element={
              billsLoading ? (
                <Center py="xl">
                  <Loader />
                </Center>
              ) : (
                <BillList
                  bills={filteredBills}
                  onEdit={handleEditBill}
                  onPay={handlePayBill}
                  onAdd={handleAddBill}
                  onViewPayments={handleViewPayments}
                  isLoggedIn={isLoggedIn}
                  hasDatabase={!!currentDb}
                  hasActiveFilter={filter.searchQuery !== '' || filter.dateRange !== 'all' || filter.selectedDate !== null}
                  onClearFilter={() => setFilter({ searchQuery: '', dateRange: 'all', selectedDate: null, type: 'all', account: null })}
                  searchQuery={filter.searchQuery}
                  onSearchChange={(query) => setFilter((prev) => ({ ...prev, searchQuery: query }))}
                  filter={filter}
                  onFilterChange={setFilter}
                />
              )
            }
          />
          <Route path="/all-payments" element={<AllPayments />} />
          {billingEnabled && (
            <>
              <Route path="/billing" element={<Billing />} />
              <Route path="/billing/success" element={<Billing />} />
              <Route path="/billing/cancel" element={<Billing />} />
            </>
          )}
        </Routes>
      </Layout>

      {/* Modals */}
      <PasswordChangeModal
        opened={passwordChangeOpened}
        onClose={() => {}}
      />

      <AdminModal opened={adminOpened} onClose={closeAdmin} />

      <BillModal
        opened={billModalOpened}
        onClose={closeBillModal}
        onSave={handleSaveBill}
        onArchive={handleArchiveBill}
        onUnarchive={handleUnarchiveBill}
        onDelete={handleDeleteBill}
        bill={currentBill}
      />

      <PayModal
        opened={payModalOpened}
        onClose={closePayModal}
        onPay={handlePay}
        bill={currentBill}
      />

      <PaymentHistory
        opened={historyOpened}
        onClose={closeHistory}
        billId={historyBillId}
        billName={historyBillName}
        onPaymentsChanged={fetchBills}
      />

      <MonthlyTotalsChart opened={chartOpened} onClose={closeChart} />
    </>
  );
}

export default App;
