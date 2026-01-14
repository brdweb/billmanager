import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Dimensions,
  FlatList,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { History, TrendingUp, TrendingDown, ChevronRight, BarChart3, LineChart, Wallet, Users } from 'lucide-react-native';
import { LineChart as RNLineChart } from 'react-native-chart-kit';
import { BarChart as GiftedBarChart } from 'react-native-gifted-charts';
import { api } from '../api/client';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { ProcessedMonthlyStats, Bill, Payment } from '../types';

type StatsStackParamList = {
  Stats: undefined;
  PaymentHistory: undefined;
  SharedBills: undefined;
};

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Define createStyles function here
const createStyles = (colors: any, insets: any) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: insets.top + 8,
    paddingBottom: 12,
    backgroundColor: colors.surface,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.text,
  },
  usernameText: {
    fontSize: 13,
    color: colors.textMuted,
  },
  headerSubtitle: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  sectionContainer: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  paymentHistoryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  paymentHistoryIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  paymentHistoryContent: {
    flex: 1,
  },
  paymentHistoryTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  paymentHistorySubtitle: {
    fontSize: 12,
    color: colors.textMuted,
  },
  carouselSection: {
    paddingTop: 16,
  },
  carouselHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  carouselIndicator: {
    fontSize: 12,
    color: colors.textMuted,
  },
  carouselContent: {
    paddingHorizontal: 0,
  },
  carouselCard: {
    borderRadius: 16,
    padding: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  monthTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  miniBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  miniBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  statsGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  statBox: {
    flex: 1,
    padding: 12,
    borderRadius: 12,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textMuted,
  },
  statValue: {
    fontSize: 16,
    fontWeight: '700',
  },
  statSubtext: {
    fontSize: 10,
    color: colors.textMuted,
    marginTop: 2,
  },
  trendsSection: {
    padding: 16,
  },
  trendsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  trendsControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  buttonGroup: {
    flexDirection: 'row',
    backgroundColor: colors.border + '40',
    borderRadius: 8,
    padding: 2,
  },
  segmentButton: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentButtonActive: {
    backgroundColor: colors.primary,
  },
  segmentText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
  },
  segmentTextActive: {
    color: '#fff',
  },
  chartCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chart: {
    marginVertical: 8,
    borderRadius: 16,
  },
  dotContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 12,
    marginBottom: 8,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginHorizontal: 3,
  },
  errorContainer: {
    padding: 32,
    alignItems: 'center',
  },
  errorText: {
    fontSize: 14,
    marginBottom: 16,
    textAlign: 'center',
  },
  retryButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: colors.primary,
  },
  retryButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  emptyCard: {
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    backgroundColor: colors.surface,
    marginHorizontal: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  emptyText: {
    fontSize: 13,
    color: colors.textMuted,
  },
  footer: {
    height: 40,
  },
});

export default function StatsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<StatsStackParamList>>();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { user, currentDatabase, databases } = useAuth();
  const [monthlyStats, setMonthlyStats] = useState<ProcessedMonthlyStats[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [chartType, setChartType] = useState<'bar' | 'line'>('line');
  const [chartRange, setChartRange] = useState<6 | 12>(6);
  const carouselRef = useRef<FlatList>(null);

  const styles = createStyles(colors, insets);

  const fetchData = useCallback(async () => {
    if (!currentDatabase) {
      setIsLoading(false);
      setError('No database selected');
      return;
    }

    try {
      const [statsRes, billsRes, paymentsRes] = await Promise.all([
        api.getMonthlyStats(),
        api.getBills(),
        api.getAllPayments()
      ]);

      let billsData: Bill[] = [];
      if (billsRes.success && Array.isArray(billsRes.data)) {
        billsData = billsRes.data;
      }

      let paymentsData: Payment[] = [];
      if (paymentsRes.success && Array.isArray(paymentsRes.data)) {
        paymentsData = paymentsRes.data;
      }

      const processedStats: ProcessedMonthlyStats[] = [];
      const now = new Date();
      
      const months = [];
      for (let i = 0; i < 12; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
      }

      const rawStats = (statsRes.data || {}) as any;
      
      months.forEach(monthKey => {
        const statsForMonth = Array.isArray(rawStats) 
          ? rawStats.find((s: any) => s.month === monthKey) 
          : rawStats[monthKey];
        
        const paid = statsForMonth?.total_expenses || statsForMonth?.expenses || 0;
        const income = statsForMonth?.total_deposits || statsForMonth?.deposits || 0;
        
        // Calculate counts from paymentsData
        const monthPayments = paymentsData.filter(p => p.payment_date.startsWith(monthKey));
        // We need to know if the payment is an expense or deposit. 
        // In enriched payments it has bill_type, but api.getAllPayments() returns raw Payment objects.
        // Wait, I need to check the Payment type in types/index.ts or the server response.
        // Server response for /payments (JWT) includes bill_type.
        const paidCount = monthPayments.filter((p: any) => p.bill_type === 'expense').length;
        const incomeCount = monthPayments.filter((p: any) => p.bill_type === 'deposit').length;
        
        let remaining = 0;
        let remainingCount = 0;
        
        const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        
        if (monthKey === currentMonthKey) {
           const unpaidBills = billsData.filter(b => b.type === 'expense' && !b.archived);
           remaining = unpaidBills.reduce((sum, b) => sum + (b.amount || 0), 0);
           remainingCount = unpaidBills.length;
        }

        processedStats.push({
          month: monthKey,
          paid,
          paidCount,
          incomeCount,
          remaining,
          income,
          remainingCount,
          net: income - paid
        });
      });

      setMonthlyStats(processedStats);
      setBills(billsData);
      setError(null);
    } catch (err) {
      setError('Failed to load statistics');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [currentDatabase]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useFocusEffect(
    useCallback(() => {
      fetchData();
    }, [fetchData])
  );

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    fetchData();
  }, [fetchData]);

  const formatCurrency = (amount: number): string => {
    return `$${Math.abs(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const formatMonth = (monthStr: string): string => {
    const [year, month] = monthStr.split('-');
    const date = new Date(parseInt(year), parseInt(month) - 1);
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  };

  const currentDbInfo = databases.find(db => db.name === currentDatabase);

  // Grouped bar chart data - expenses and income side by side
  const groupedBarChartData = useMemo(() => {
    if (!monthlyStats || monthlyStats.length === 0) {
      return [];
    }
    const data = [...monthlyStats].reverse().slice(-chartRange);
    if (data.length === 0) {
      return [];
    }

    const barData: any[] = [];
    data.forEach((d, index) => {
      const [_, m] = d.month.split('-');
      const date = new Date(2000, parseInt(m) - 1, 1);
      const label = date.toLocaleDateString('en-US', { month: 'short' });

      // Expense bar
      barData.push({
        value: d.paid || 0,
        frontColor: colors.danger,
        label: label,
        labelTextStyle: { color: colors.textMuted, fontSize: 10 },
        spacing: 2,
      });

      // Income bar
      barData.push({
        value: d.income || 0,
        frontColor: colors.success,
        spacing: chartRange === 6 ? 16 : 8,
      });
    });

    return barData;
  }, [monthlyStats, chartRange, colors.danger, colors.success, colors.textMuted]);

  // Line chart data - supports multiple datasets (expenses + income)
  const lineChartData = useMemo(() => {
    if (!monthlyStats || monthlyStats.length === 0) {
      return {
        labels: [''],
        datasets: [{ data: [0], color: (opacity = 1) => colors.danger }],
      };
    }
    const data = [...monthlyStats].reverse().slice(-chartRange);
    if (data.length === 0) {
      return {
        labels: [''],
        datasets: [{ data: [0], color: (opacity = 1) => colors.danger }],
      };
    }
    const hasAnyIncome = data.some(d => d.income > 0);

    const datasets: Array<{ data: number[]; color: (opacity?: number) => string }> = [{
      data: data.map(d => d.paid || 0),
      color: (opacity = 1) => colors.danger,
    }];

    // Add income dataset only if there's income data to show
    if (hasAnyIncome) {
      datasets.push({
        data: data.map(d => d.income || 0),
        color: (opacity = 1) => colors.success,
      });
    }

    return {
      labels: data.map(d => {
        const [_, m] = d.month.split('-');
        const date = new Date(2000, parseInt(m) - 1, 1);
        return date.toLocaleDateString('en-US', { month: 'short' });
      }),
      datasets,
      legend: hasAnyIncome ? ['Expenses', 'Income'] : ['Expenses'],
    };
  }, [monthlyStats, chartRange, colors.danger, colors.success]);

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const barChartConfig = {
    backgroundGradientFrom: colors.surface,
    backgroundGradientTo: colors.surface,
    color: (opacity = 1) => colors.danger,
    labelColor: (opacity = 1) => colors.textMuted,
    barPercentage: 0.6,
    decimalPlaces: 0,
    propsForBackgroundLines: {
      strokeDasharray: "",
      stroke: colors.border + '40',
    }
  };

  const lineChartConfig = {
    backgroundGradientFrom: colors.surface,
    backgroundGradientTo: colors.surface,
    fillShadowGradientFromOpacity: 0.2,
    fillShadowGradientToOpacity: 0.05,
    color: (opacity = 1) => colors.danger,
    labelColor: (opacity = 1) => colors.textMuted,
    strokeWidth: 2,
    useShadowColorFromDataset: true,
    decimalPlaces: 0,
    propsForDots: {
      r: "4",
      strokeWidth: "2",
    },
    propsForBackgroundLines: {
      strokeDasharray: "",
      stroke: colors.border + '40',
    }
  };

  return (
    <ScrollView
      style={styles.container}
      refreshControl={
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={handleRefresh}
          tintColor={colors.primary}
          colors={[colors.primary]}
        />
      }
    >
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Text style={styles.headerTitle}>Statistics</Text>
          <Text style={styles.usernameText}>{user?.username}</Text>
        </View>
        <Text style={styles.headerSubtitle}>
          {currentDbInfo?.display_name || 'Overview'}
        </Text>
      </View>

      {error ? (
        <View style={styles.errorContainer}>
          <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={fetchData}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <View style={styles.sectionContainer}>
            <TouchableOpacity
              style={styles.paymentHistoryButton}
              onPress={() => navigation.navigate('PaymentHistory')}
            >
              <View style={styles.paymentHistoryIconContainer}>
                <History size={20} color={colors.primary} />
              </View>
              <View style={styles.paymentHistoryContent}>
                <Text style={styles.paymentHistoryTitle}>Payment History</Text>
                <Text style={styles.paymentHistorySubtitle}>All recorded payments</Text>
              </View>
              <ChevronRight size={20} color={colors.textMuted} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.paymentHistoryButton, { marginTop: 12 }]}
              onPress={() => navigation.navigate('SharedBills')}
            >
              <View style={[styles.paymentHistoryIconContainer, { backgroundColor: colors.success + '15' }]}>
                <Users size={20} color={colors.success} />
              </View>
              <View style={styles.paymentHistoryContent}>
                <Text style={styles.paymentHistoryTitle}>Shared Bills</Text>
                <Text style={styles.paymentHistorySubtitle}>Bills shared with you</Text>
              </View>
              <ChevronRight size={20} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          {/* Monthly History Carousel */}
          <View style={styles.carouselSection}>
            <View style={styles.carouselHeader}>
              <Text style={styles.sectionTitle}>Monthly History</Text>
              {monthlyStats.length > 0 && (
                <Text style={styles.carouselIndicator}>
                  {currentIndex + 1} / {Math.min(monthlyStats.length, 12)}
                </Text>
              )}
            </View>
            
            {monthlyStats.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyText}>No data available</Text>
              </View>
            ) : (
              <>
                <FlatList
                  ref={carouselRef}
                  data={monthlyStats.slice(0, 12)}
                  horizontal
                  pagingEnabled
                  showsHorizontalScrollIndicator={false}
                  snapToInterval={SCREEN_WIDTH}
                  decelerationRate="fast"
                  contentContainerStyle={styles.carouselContent}
                  onMomentumScrollEnd={(e) => {
                    const index = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
                    setCurrentIndex(index);
                  }}
                  keyExtractor={(item) => item.month}
                  renderItem={({ item: stat }) => (
                    <View style={{ width: SCREEN_WIDTH, paddingHorizontal: 16 }}>
                      <View style={styles.carouselCard}>
                        <View style={styles.cardTopRow}>
                          <Text style={styles.monthTitle}>{formatMonth(stat.month)}</Text>
                          <View style={[styles.miniBadge, { backgroundColor: stat.net >= 0 ? colors.success + '15' : colors.danger + '15' }]}>
                            <Text style={[styles.miniBadgeText, { color: stat.net >= 0 ? colors.success : colors.danger }]}>
                              {stat.net >= 0 ? '+' : '-'}{formatCurrency(stat.net)} Net
                            </Text>
                          </View>
                        </View>

                        <View style={styles.statsGrid}>
                          <View style={styles.statBox}>
                            <View style={styles.statHeader}>
                              <TrendingDown size={16} color={colors.danger} />
                              <Text style={styles.statLabel}>Paid</Text>
                            </View>
                            <Text style={[styles.statValue, { color: colors.danger }]}>
                              -{formatCurrency(stat.paid)}
                            </Text>
                            {stat.paidCount > 0 && (
                              <Text style={styles.statSubtext}>{stat.paidCount} items</Text>
                            )}
                          </View>
                          {stat.income > 0 && (
                            <View style={styles.statBox}>
                              <View style={styles.statHeader}>
                                <TrendingUp size={16} color={colors.success} />
                                <Text style={styles.statLabel}>Income</Text>
                              </View>
                              <Text style={[styles.statValue, { color: colors.success }]}>
                                +{formatCurrency(stat.income)}
                              </Text>
                              {stat.incomeCount > 0 && (
                                <Text style={styles.statSubtext}>{stat.incomeCount} items</Text>
                              )}
                            </View>
                          )}
                          <View style={styles.statBox}>
                            <View style={styles.statHeader}>
                              <Wallet size={16} color={colors.warning || '#f59e0b'} />
                              <Text style={styles.statLabel}>Remaining</Text>
                            </View>
                            <Text style={[styles.statValue, { color: colors.warning || '#f59e0b' }]}>
                              {formatCurrency(stat.remaining)}
                            </Text>
                            {stat.remainingCount > 0 && (
                              <Text style={styles.statSubtext}>{stat.remainingCount} items</Text>
                            )}
                          </View>
                        </View>
                      </View>
                    </View>
                  )}
                />
                <View style={styles.dotContainer}>
                  {monthlyStats.slice(0, 12).map((_, index) => (
                    <View
                      key={index}
                      style={[
                        styles.dot,
                        { backgroundColor: index === currentIndex ? colors.primary : colors.border },
                      ]}
                    />
                  ))}
                </View>
              </>
            )}
          </View>

          {/* Spending Trends Section */}
          <View style={styles.trendsSection}>
            <View style={styles.trendsHeader}>
              <Text style={styles.sectionTitle}>Spending Trends</Text>
              <View style={styles.trendsControls}>
                <View style={styles.buttonGroup}>
                  <TouchableOpacity 
                    onPress={() => setChartRange(6)}
                    style={[styles.segmentButton, chartRange === 6 && styles.segmentButtonActive]}
                  >
                    <Text style={[styles.segmentText, chartRange === 6 && styles.segmentTextActive]}>6M</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    onPress={() => setChartRange(12)}
                    style={[styles.segmentButton, chartRange === 12 && styles.segmentButtonActive]}
                  >
                    <Text style={[styles.segmentText, chartRange === 12 && styles.segmentTextActive]}>12M</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.buttonGroup}>
                  <TouchableOpacity 
                    onPress={() => setChartType('line')}
                    style={[styles.segmentButton, chartType === 'line' && styles.segmentButtonActive]}
                  >
                    <LineChart size={16} color={chartType === 'line' ? '#fff' : colors.primary} />
                  </TouchableOpacity>
                  <TouchableOpacity 
                    onPress={() => setChartType('bar')}
                    style={[styles.segmentButton, chartType === 'bar' && styles.segmentButtonActive]}
                  >
                    <BarChart3 size={16} color={chartType === 'bar' ? '#fff' : colors.primary} />
                  </TouchableOpacity>
                </View>
              </View>
            </View>

            <View style={styles.chartCard}>
              {monthlyStats.length > 0 ? (
                chartType === 'bar' && groupedBarChartData.length > 0 ? (
                  <View>
                    <GiftedBarChart
                      data={groupedBarChartData}
                      width={SCREEN_WIDTH - 80}
                      height={180}
                      barWidth={chartRange === 6 ? 14 : 8}
                      noOfSections={4}
                      yAxisThickness={0}
                      xAxisThickness={1}
                      xAxisColor={colors.border}
                      yAxisTextStyle={{ color: colors.textMuted, fontSize: 10 }}
                      hideRules
                      showYAxisIndices={false}
                      formatYLabel={(val: string) => `$${parseInt(val)}`}
                    />
                    <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: 8, gap: 16 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <View style={{ width: 12, height: 12, backgroundColor: colors.danger, borderRadius: 2 }} />
                        <Text style={{ color: colors.textMuted, fontSize: 11 }}>Expenses</Text>
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <View style={{ width: 12, height: 12, backgroundColor: colors.success, borderRadius: 2 }} />
                        <Text style={{ color: colors.textMuted, fontSize: 11 }}>Income</Text>
                      </View>
                    </View>
                  </View>
                ) : chartType === 'line' && lineChartData?.labels?.length > 0 ? (
                  <RNLineChart
                    data={lineChartData}
                    width={SCREEN_WIDTH - 64}
                    height={220}
                    yAxisLabel="$"
                    chartConfig={lineChartConfig}
                    bezier
                    style={styles.chart}
                  />
                ) : (
                  <ActivityIndicator color={colors.primary} />
                )
              ) : (
                <ActivityIndicator color={colors.primary} />
              )}
            </View>
          </View>

          <View style={styles.footer} />
        </>
      )}
    </ScrollView>
  );
}
