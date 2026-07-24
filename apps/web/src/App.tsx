import { lazy, Suspense, useState, useEffect, useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import { Stack, Loader, Center, Divider, Text, Anchor } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { Routes, Route, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Layout } from './components/Layout';
import { Sidebar } from './components/Sidebar';
import { BillList } from './components/BillList';
import { PayModal } from './components/PayModal';
import { Calendar } from './components/Calendar';
import { ReminderAlertsWidget } from './components/ReminderAlertsWidget';
import { currentVersion, hasUnseenReleaseNotes } from './config/releaseNotes';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { useAuth } from './context/AuthContext';
import { useConfig } from './context/ConfigContext';
import * as api from './api/client';
import type { Bill } from './api/client';
import { archiveBill, unarchiveBill, deleteBillPermanent, ApiError } from './api/client';

const AllPayments = lazy(() => import('./pages/AllPayments').then((module) => ({ default: module.AllPayments })));
const VerifyEmail = lazy(() => import('./pages/VerifyEmail').then((module) => ({ default: module.VerifyEmail })));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword').then((module) => ({ default: module.ForgotPassword })));
const ResetPassword = lazy(() => import('./pages/ResetPassword').then((module) => ({ default: module.ResetPassword })));
const ResendVerification = lazy(() => import('./pages/ResendVerification').then((module) => ({ default: module.ResendVerification })));
const AcceptInvite = lazy(() => import('./pages/AcceptInvite').then((module) => ({ default: module.AcceptInvite })));
const AcceptShareInvite = lazy(() => import('./pages/AcceptShareInvite').then((module) => ({ default: module.AcceptShareInvite })));
const AuthCallback = lazy(() => import('./pages/AuthCallback').then((module) => ({ default: module.AuthCallback })));
const Billing = lazy(() => import('./pages/Billing').then((module) => ({ default: module.Billing })));
const CalendarPage = lazy(() => import('./pages/CalendarPage').then((module) => ({ default: module.CalendarPage })));
const Analytics = lazy(() => import('./pages/Analytics').then((module) => ({ default: module.Analytics })));
const Settlements = lazy(() => import('./pages/Settlements').then((module) => ({ default: module.Settlements })));
const Settings = lazy(() => import('./pages/Settings').then((module) => ({ default: module.Settings })));
const BillModal = lazy(() => import('./components/BillModal').then((module) => ({ default: module.BillModal })));
const PaymentHistory = lazy(() => import('./components/PaymentHistory').then((module) => ({ default: module.PaymentHistory })));
const PasswordChangeModal = lazy(() => import('./components/PasswordChangeModal').then((module) => ({ default: module.PasswordChangeModal })));
const TelemetryNoticeModal = lazy(() => import('./components/TelemetryNoticeModal').then((module) => ({ default: module.TelemetryNoticeModal })));
const ReleaseNotesModal = lazy(() => import('./components/ReleaseNotesModal').then((module) => ({ default: module.ReleaseNotesModal })));

// Helper to show error notifications
function showError(title: string, error: unknown, t: TFunction) {
  const message = error instanceof ApiError ? error.message : t('app.unexpectedError');
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

function LoadingFallback() {
  return (
    <Center py="xl">
      <Loader />
    </Center>
  );
}

function LazyRoute({ children }: { children: ReactNode }) {
  return <Suspense fallback={<LoadingFallback />}>{children}</Suspense>;
}

// Filter types
export type DateRangeFilter = 'all' | 'overdue' | 'thisWeek' | 'nextWeek' | 'next21Days' | 'next30Days';

export interface BillFilter {
  searchQuery: string;
  dateRange: DateRangeFilter;
  selectedDate: string | null; // YYYY-MM-DD format
  type: 'all' | 'expense' | 'deposit';
  account: string | null;
  category: string | null;
}

function App() {
  const { t } = useTranslation();
  const { isLoggedIn, isAdmin, isLoading, pendingPasswordChange, currentDb, databases } = useAuth();
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
    category: null,
  });

  // Modal states
  const [billModalOpened, { open: openBillModal, close: closeBillModal }] = useDisclosure(false);
  const [payModalOpened, { open: openPayModal, close: closePayModal }] = useDisclosure(false);
  const [historyOpened, { open: openHistory, close: closeHistory }] = useDisclosure(false);
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
        const categoryMatch = bill.category?.toLowerCase().includes(query);
        const notesMatch = bill.notes?.toLowerCase().includes(query);
        return nameMatch || amountMatch || dateMatch || categoryMatch || notesMatch;
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

    // Apply category filter
    if (filter.category) {
      result = result.filter((bill) => bill.category === filter.category);
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
        showSuccess(t('app.billUpdated'));
      } else {
        await api.addBill(billData);
        showSuccess(t('app.billCreated'));
      }
      await fetchBills();
    } catch (error) {
      showError(t('app.saveFailed'), error, t);
      throw error; // Re-throw to let BillModal handle loading state
    }
  };

  const handleArchiveBill = async (bill: Bill) => {
    try {
      await archiveBill(bill.id);
      showSuccess(t('app.billArchived'));
      await fetchBills();
    } catch (error) {
      showError(t('app.archiveFailed'), error, t);
      throw error;
    }
  };

  const handleDeleteBill = async (bill: Bill) => {
    try {
      await deleteBillPermanent(bill.id);
      showSuccess(t('app.billDeleted'));
      await fetchBills();
    } catch (error) {
      showError(t('app.deleteFailed'), error, t);
      throw error;
    }
  };

  const handleUnarchiveBill = async (bill: Bill) => {
    try {
      await unarchiveBill(bill.id);
      showSuccess(t('app.billRestored'));
      await fetchBills();
    } catch (error) {
      showError(t('app.restoreFailed'), error, t);
      throw error;
    }
  };

  const handlePay = async (amount: number, advanceDue: boolean) => {
    if (!currentBill) return;
    try {
      await api.payBill(currentBill.id, amount, advanceDue);
      showSuccess(t('app.paymentRecorded'));
      await fetchBills();
    } catch (error) {
      showError(t('app.recordPaymentFailed'), error, t);
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
  const publicRoutes = ['/login', '/register', '/verify-email', '/forgot-password', '/reset-password', '/resend-verification', '/accept-invite', '/accept-share-invite', '/auth/callback'];
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
          <Route path="/verify-email" element={<LazyRoute><VerifyEmail /></LazyRoute>} />
          <Route path="/forgot-password" element={<LazyRoute><ForgotPassword /></LazyRoute>} />
          <Route path="/reset-password" element={<LazyRoute><ResetPassword /></LazyRoute>} />
          <Route path="/resend-verification" element={<LazyRoute><ResendVerification /></LazyRoute>} />
          <Route path="/accept-invite" element={<LazyRoute><AcceptInvite /></LazyRoute>} />
          <Route path="/accept-share-invite" element={<LazyRoute><AcceptShareInvite /></LazyRoute>} />
          <Route path="/auth/callback" element={<LazyRoute><AuthCallback /></LazyRoute>} />
        </Routes>
        {/* Password change modal must be accessible from login page */}
        {passwordChangeOpened && (
          <Suspense fallback={null}>
            <PasswordChangeModal
              opened={passwordChangeOpened}
              onClose={() => {}}
            />
          </Suspense>
        )}
      </>
    );
  }

  return (
    <>
      <Layout
        onSettingsClick={() => navigate(isAdmin ? '/settings?tab=users' : '/settings')}
        onBillingClick={billingEnabled ? () => navigate('/billing') : undefined}
        sidebar={
          <Stack gap="xs" style={{ minHeight: 'calc(100vh - 92px)' }}>
            <Sidebar
              bills={bills}
              isLoggedIn={isLoggedIn}
              filter={filter}
              onFilterChange={setFilter}
            />
            {isLoggedIn && (
              <Calendar
                bills={bills}
                selectedDate={filter.selectedDate}
                onDateSelect={(date) => {
                  setFilter((prev) => ({
                    ...prev,
                    selectedDate: date === prev.selectedDate ? null : date,
                    dateRange: 'all',
                  }));
                  navigate('/bills');
                }}
              />
            )}
            {/* Spacer pushes footer to bottom */}
            <div style={{ flex: 1 }} />
            {isLoggedIn && (
              <>
                <Divider />
                <Text size="xs" c="dimmed" ta="center">
                  BillManager{' '}
                  <Anchor component="button" size="xs" onClick={openReleaseNotes}>
                    v{currentVersion}
                  </Anchor>
                  {' '}{t('app.footerLicensedUnder')}{' '}
                  <Anchor href="https://osaasy.dev/" target="_blank" rel="noopener noreferrer" size="xs">
                    O'Saasy
                  </Anchor>
                </Text>
                <Text size="xs" ta="center">
                  <Anchor href="https://docs.billmanager.app" target="_blank" rel="noopener noreferrer" size="xs">
                    {t('app.needHelp')}
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
                onStatClick={(stat) => {
                  if (stat === 'total') {
                    setFilter({ searchQuery: '', dateRange: 'all', selectedDate: null, type: 'all', account: null, category: null });
                  } else if (stat === 'thisWeek') {
                    setFilter({ searchQuery: '', dateRange: 'thisWeek', selectedDate: null, type: 'all', account: null, category: null });
                  } else if (stat === 'overdue') {
                    setFilter({ searchQuery: '', dateRange: 'overdue', selectedDate: null, type: 'all', account: null, category: null });
                  }
                  navigate('/bills');
                }}
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
                    hasActiveFilter={filter.searchQuery !== '' || filter.dateRange !== 'all' || filter.selectedDate !== null || filter.type !== 'all' || filter.account !== null || filter.category !== null}
                    onClearFilter={() => setFilter({ searchQuery: '', dateRange: 'all', selectedDate: null, type: 'all', account: null, category: null })}
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
          <Route path="/all-payments" element={<LazyRoute><AllPayments /></LazyRoute>} />
          <Route
            path="/calendar"
            element={
              <LazyRoute>
                <CalendarPage
                  bills={bills}
                  onAddBill={handleAddBill}
                  onPayBill={handlePayBill}
                  onEditBill={handleEditBill}
                  hasDatabase={!!currentDb}
                />
              </LazyRoute>
            }
          />
          <Route
            path="/analytics"
            element={<LazyRoute><Analytics hasDatabase={!!currentDb} currentDb={currentDb} /></LazyRoute>}
          />
          <Route path="/settlements" element={<LazyRoute><Settlements hasDatabase={!!currentDb} /></LazyRoute>} />
          <Route path="/settings" element={<LazyRoute><Settings /></LazyRoute>} />
          {billingEnabled && (
            <>
              <Route path="/billing" element={<LazyRoute><Billing /></LazyRoute>} />
              <Route path="/billing/success" element={<LazyRoute><Billing /></LazyRoute>} />
              <Route path="/billing/cancel" element={<LazyRoute><Billing /></LazyRoute>} />
            </>
          )}
        </Routes>
      </Layout>

      <ReminderAlertsWidget
        bills={bills}
        hasDatabase={!!currentDb}
        onPayBill={handlePayBill}
      />

      {/* Modals */}
      <Suspense fallback={null}>
        {passwordChangeOpened && (
          <PasswordChangeModal
            opened={passwordChangeOpened}
            onClose={() => {}}
          />
        )}

        {billModalOpened && (
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
        )}
      </Suspense>

      <PayModal
        opened={payModalOpened}
        onClose={closePayModal}
        onPay={handlePay}
        bill={currentBill}
      />

      <Suspense fallback={null}>
        {historyOpened && (
          <PaymentHistory
            opened={historyOpened}
            onClose={closeHistory}
            billId={historyBillId}
            billName={historyBillName}
            isShared={historyBillIsShared}
            shareInfo={historyBillShareInfo}
            onPaymentsChanged={fetchBills}
          />
        )}

        {telemetryModalOpened && (
          <TelemetryNoticeModal opened={telemetryModalOpened} onClose={closeTelemetryModal} />
        )}

        {releaseNotesOpened && (
          <ReleaseNotesModal key={releaseNotesKey} opened={releaseNotesOpened} onClose={closeReleaseNotes} />
        )}
      </Suspense>
    </>
  );
}

export default App;
