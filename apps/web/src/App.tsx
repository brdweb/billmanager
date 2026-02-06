import { useState, useEffect, useCallback, useMemo } from 'react';
import { Stack, Loader, Center, Divider, Text, Anchor } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
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
import { TelemetryNoticeModal } from './components/TelemetryNoticeModal';
import { ReleaseNotesModal } from './components/ReleaseNotesModal';
import { currentVersion, hasUnseenReleaseNotes } from './config/releaseNotes';
import { AllPayments } from './pages/AllPayments';
import { Login } from './pages/Login';
import { VerifyEmail } from './pages/VerifyEmail';
import { ForgotPassword } from './pages/ForgotPassword';
import { ResetPassword } from './pages/ResetPassword';
import { ResendVerification } from './pages/ResendVerification';
import { AcceptInvite } from './pages/AcceptInvite';
import { AcceptShareInvite } from './pages/AcceptShareInvite';
import { Billing } from './pages/Billing';
import { Dashboard } from './pages/Dashboard';
import { CalendarPage } from './pages/CalendarPage';
import { Analytics } from './pages/Analytics';
import { useAuth } from './context/AuthContext';
import { useConfig } from './context/ConfigContext';
import * as api from './api/client';
import type { Bill } from './api/client';
import { archiveBill, unarchiveBill, deleteBillPermanent, ApiError } from './api/client';

// Helper to show error notifications
function showError(title: string, error: unknown) {
  const message = error instanceof ApiError ? error.message : 'An unexpected error occurred';
  notifications.show({
    title,
    message,
    color: 'red',
    autoClose: 5000,
  });
}

// Helper to show success notifications
function showSuccess(message: string) {
  notifications.show({
    message,
    color: 'green',
    autoClose: 3000,
  });
}

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
  const { isLoggedIn, isLoading, pendingPasswordChange, currentDb, databases } = useAuth();
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
  const [telemetryModalOpened, { open: openTelemetryModal, close: closeTelemetryModal }] = useDisclosure(false);
  const [releaseNotesOpened, { open: doOpenReleaseNotes, close: closeReleaseNotes }] = useDisclosure(false);
  const [releaseNotesKey, setReleaseNotesKey] = useState(0);

  // Wrapper to reset modal state when opening
  const openReleaseNotes = useCallback(() => {
    setReleaseNotesKey((k) => k + 1);
    doOpenReleaseNotes();
  }, [doOpenReleaseNotes]);

  // Current editing/paying bill
  const [currentBill, setCurrentBill] = useState<Bill | null>(null);
  const [historyBillId, setHistoryBillId] = useState<number | null>(null);
  const [historyBillName, setHistoryBillName] = useState<string | null>(null);
  const [historyBillIsShared, setHistoryBillIsShared] = useState<boolean>(false);
  const [historyBillShareInfo, setHistoryBillShareInfo] = useState<Bill['share_info'] | null>(null);

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
      // Process auto-payments first (ignore errors - admin only feature)
      try {
        await api.processAutoPayments();
      } catch {
        // Silently ignore auto-payment errors (403 for non-admins is expected)
      }

      // Fetch bills (include archived so they can be searched)
      const response = await api.getBills(true);
      setBills(Array.isArray(response) ? response : []);
    } catch {
      setBills([]);
    } finally {
      setBillsLoading(false);
    }
  }, [isLoggedIn, currentDb]);

  // Fetch bills when logged in or database changes
  useEffect(() => {
    fetchBills();
  }, [fetchBills]);

  // Check telemetry notice status on login
  useEffect(() => {
    const checkTelemetryNotice = async () => {
      if (!isLoggedIn || isLoading) {
        return;
      }

      try {
        const noticeData = await api.getTelemetryNotice();
        if (noticeData.show_notice) {
          openTelemetryModal();
        }
      } catch {
        // Silently fail - telemetry notice is not critical
      }
    };

    checkTelemetryNotice();
  }, [isLoggedIn, isLoading, openTelemetryModal]);

  // Check for new release notes on login
  useEffect(() => {
    if (isLoggedIn && !isLoading && hasUnseenReleaseNotes()) {
      // Small delay to not overwhelm user with multiple modals
      const timer = setTimeout(() => {
        openReleaseNotes();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [isLoggedIn, isLoading, openReleaseNotes]);

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
    setHistoryBillIsShared(bill.is_shared || false);
    setHistoryBillShareInfo(bill.share_info || null);
    openHistory();
  };

  const handleSaveBill = async (billData: Partial<Bill>) => {
    try {
      if (currentBill) {
        await api.updateBill(currentBill.id, billData);
        showSuccess('Bill updated successfully');
      } else {
        await api.addBill(billData);
        showSuccess('Bill created successfully');
      }
      await fetchBills();
    } catch (error) {
      showError('Failed to save bill', error);
      throw error; // Re-throw to let BillModal handle loading state
    }
  };

  const handleArchiveBill = async (bill: Bill) => {
    try {
      await archiveBill(bill.id);
      showSuccess('Bill archived successfully');
      await fetchBills();
    } catch (error) {
      showError('Failed to archive bill', error);
      throw error;
    }
  };

  const handleDeleteBill = async (bill: Bill) => {
    try {
      await deleteBillPermanent(bill.id);
      showSuccess('Bill deleted permanently');
      await fetchBills();
    } catch (error) {
      showError('Failed to delete bill', error);
      throw error;
    }
  };

  const handleUnarchiveBill = async (bill: Bill) => {
    try {
      await unarchiveBill(bill.id);
      showSuccess('Bill restored successfully');
      await fetchBills();
    } catch (error) {
      showError('Failed to restore bill', error);
      throw error;
    }
  };

  const handlePay = async (amount: number, advanceDue: boolean) => {
    if (!currentBill) return;
    try {
      await api.payBill(currentBill.id, amount, advanceDue);
      showSuccess('Payment recorded successfully');
      await fetchBills();
    } catch (error) {
      showError('Failed to record payment', error);
      throw error;
    }
  };

  if (isLoading) {
    return (
      <Center h="100vh">
        <Loader size="xl" />
      </Center>
    );
  }

  // Public routes - no authentication required
  const publicRoutes = ['/login', '/register', '/verify-email', '/forgot-password', '/reset-password', '/resend-verification', '/accept-invite', '/accept-share-invite'];
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
          <Route path="/accept-share-invite" element={<AcceptShareInvite />} />
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
                  BillManager{' '}
                  <Anchor component="button" size="xs" onClick={openReleaseNotes}>
                    v{currentVersion}
                  </Anchor>
                  {' '}- Licensed under{' '}
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
              <Dashboard
                bills={bills}
                loading={billsLoading}
                onAddBill={handleAddBill}
                onEditBill={handleEditBill}
                onPayBill={handlePayBill}
                onViewPayments={handleViewPayments}
                onViewBills={() => navigate('/bills')}
                hasDatabase={!!currentDb}
              />
            }
          />
          <Route
            path="/bills"
            element={
              billsLoading ? (
                <Center py="xl">
                  <Loader />
                </Center>
              ) : (
                <Stack gap="md">
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
                    onRefresh={fetchBills}
                    isAllBucketsMode={currentDb === '_all_'}
                  />
                </Stack>
              )
            }
          />
          <Route path="/all-payments" element={<AllPayments />} />
          <Route
            path="/calendar"
            element={
              <CalendarPage
                bills={bills}
                onAddBill={handleAddBill}
                onPayBill={handlePayBill}
                onEditBill={handleEditBill}
                hasDatabase={!!currentDb}
              />
            }
          />
          <Route
            path="/analytics"
            element={<Analytics hasDatabase={!!currentDb} />}
          />
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
        isAllBucketsMode={currentDb === '_all_'}
        databases={databases}
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
        isShared={historyBillIsShared}
        shareInfo={historyBillShareInfo}
        onPaymentsChanged={fetchBills}
      />

      <MonthlyTotalsChart opened={chartOpened} onClose={closeChart} />

      <TelemetryNoticeModal opened={telemetryModalOpened} onClose={closeTelemetryModal} />

      <ReleaseNotesModal key={releaseNotesKey} opened={releaseNotesOpened} onClose={closeReleaseNotes} />
    </>
  );
}

export default App;
