import React from 'react';
import { View } from 'react-native';
import {
  // Finance & Payment
  CreditCard,
  Landmark,
  Wallet,
  Coins,
  Banknote,
  PiggyBank,
  Receipt,
  DollarSign,
  CircleDollarSign,
  // Property & Home
  Home,
  Building,
  Building2,
  Warehouse,
  Factory,
  Store,
  // Utilities
  Lightbulb,
  Zap,
  Droplet,
  Flame,
  Wind,
  Thermometer,
  Wifi,
  Router,
  Tv,
  Cable,
  // Vehicles & Transportation
  Car,
  Truck,
  Bus,
  Bike,
  Plane,
  Ship,
  Sailboat,
  Fuel,
  Caravan,
  // Sports & Recreation
  Trophy,
  Dumbbell,
  Footprints,
  Goal,
  Volleyball,
  // Medical & Health
  Heart,
  Pill,
  Activity,
  Stethoscope,
  Syringe,
  Ambulance,
  Cross,
  // Shopping & Food
  ShoppingCart,
  // Entertainment
  Film,
  Music,
  Gamepad2,
  Monitor,
  Mic,
  Camera,
  // Technology
  Phone,
  Smartphone,
  Laptop,
  Tablet,
  Watch,
  // Education & Work
  GraduationCap,
  School,
  Briefcase,
  // Insurance & Legal
  Shield,
  Lock,
  Key,
  Scale,
  FileText,
  // Personal Care
  Scissors,
  Shirt,
  // Pets
  Dog,
  Cat,
  PawPrint,
  // Family & Misc
  Baby,
  Gift,
  Users,
  User,
  UserPlus,
  // Services & Maintenance
  Wrench,
  Hammer,
  PaintBucket,
  Drill,
  // Garden & Outdoor
  TreePine,
  Leaf,
  Flower,
  Sprout,
  // Weather
  Sun,
  Moon,
  Cloud,
  Umbrella,
  CloudRain,
  // General
  AlertCircle,
  LucideIcon,
} from 'lucide-react-native';
import { useTheme } from '../context/ThemeContext';

// Map of icon names to Lucide icon components
const iconMap: Record<string, LucideIcon> = {
  // ===== FINANCE & PAYMENT =====
  // Credit Cards & Payment Methods
  credit_card: CreditCard,
  card: CreditCard,
  payment: CreditCard,
  creditcard: CreditCard,
  debit_card: CreditCard,
  visa: CreditCard,
  mastercard: CreditCard,
  amex: CreditCard,
  discover: CreditCard,

  // Banks & Accounts
  bank: Landmark,
  account_balance: Landmark,
  banking: Landmark,

  // Money & Currency
  money: Coins,
  cash: Banknote,
  dollar: DollarSign,
  currency: CircleDollarSign,
  attach_money: Coins,
  monetization_on: Banknote,
  currency_exchange: Banknote,

  // Savings & Wallets
  savings: PiggyBank,
  piggy_bank: PiggyBank,
  wallet: Wallet,
  account_balance_wallet: Wallet,

  // Bills & Receipts
  receipt: Receipt,
  bill: Receipt,
  invoice: Receipt,

  // ===== PROPERTY & HOME =====
  home: Home,
  house: Home,
  real_estate: Home,
  apartment: Building2,
  condo: Building2,
  building: Building,
  office: Building,
  business: Building,
  corporate_fare: Building,
  domain: Building,
  warehouse: Warehouse,
  storage: Warehouse,
  factory: Factory,
  manufacturing: Factory,
  store: Store,
  shop: Store,
  retail: Store,
  garage: Building,

  // ===== UTILITIES =====
  // Electricity
  electric: Zap,
  electricity: Zap,
  power: Zap,
  electrical_services: Lightbulb,
  lightbulb: Lightbulb,
  light: Lightbulb,

  // Water
  water: Droplet,
  water_drop: Droplet,

  // Gas & Heating
  gas: Flame,
  heating: Flame,
  local_fire_department: Flame,
  thermostat: Thermometer,
  hvac: Wind,
  ac_unit: Wind,
  air_conditioning: Wind,

  // Internet & Cable
  internet: Wifi,
  wifi: Wifi,
  router: Router,
  cable: Cable,
  tv: Tv,
  television: Tv,
  satellite: Tv,

  // ===== VEHICLES & TRANSPORTATION =====
  // Cars & Trucks
  car: Car,
  auto: Car,
  vehicle: Car,
  directions_car: Car,
  taxi: Car,
  uber: Car,
  lyft: Car,
  truck: Truck,
  pickup: Truck,
  semi: Truck,

  // Other Vehicles
  rv: Caravan,
  motorhome: Caravan,
  camper: Caravan,
  boat: Sailboat,
  yacht: Ship,
  motorcycle: Bike,
  bike: Bike,
  bicycle: Bike,
  pedal_bike: Bike,

  // Public Transit
  bus: Bus,
  train: Bus,
  transit: Bus,
  local_shipping: Bus,
  flight: Plane,
  airplane: Plane,

  // Fuel & Parking
  fuel: Fuel,
  gas_station: Fuel,
  local_gas_station: Fuel,
  parking: Car,
  local_parking: Car,
  car_repair: Wrench,

  // ===== SPORTS & RECREATION =====
  // General Sports
  sports: Trophy,
  trophy: Trophy,
  athletics: Trophy,

  // Specific Sports
  soccer: Trophy,
  football: Trophy,
  sports_soccer: Trophy,
  baseball: Trophy,
  basketball: Trophy,
  sports_basketball: Trophy,
  tennis: Trophy,
  sports_tennis: Trophy,
  volleyball: Volleyball,
  golf: Trophy,
  golf_course: Trophy,

  // Fitness
  fitness: Dumbbell,
  gym: Dumbbell,
  fitness_center: Dumbbell,
  workout: Dumbbell,
  exercise: Footprints,
  running: Footprints,

  // Outdoor Recreation
  pool: Umbrella,
  swimming: Umbrella,
  beach: Sun,
  beach_access: Sun,
  camping: TreePine,
  hiking: Footprints,
  kayaking: Umbrella,

  // ===== MEDICAL & HEALTH =====
  medical: Heart,
  health: Heart,
  healthcare: Activity,
  medical_services: Activity,
  hospital: Ambulance,
  local_hospital: Ambulance,
  emergency: Ambulance,

  // Doctors & Specialists
  doctor: Stethoscope,
  physician: Stethoscope,
  dental: Cross,
  dentist: Cross,
  orthodontist: Cross,

  // Pharmacy & Medication
  pharmacy: Pill,
  local_pharmacy: Pill,
  medication: Pill,
  prescription: Pill,
  vaccines: Syringe,
  immunization: Syringe,

  // Wellness
  spa: Leaf,
  wellness: Heart,
  healing: Heart,
  therapy: Heart,
  mental_health: Heart,

  // ===== SHOPPING =====
  shopping: ShoppingCart,
  groceries: ShoppingCart,
  shopping_cart: ShoppingCart,
  supermarket: ShoppingCart,
  local_grocery_store: ShoppingCart,

  // ===== ENTERTAINMENT =====
  // Movies & Shows
  movie: Film,
  movies: Film,
  cinema: Film,
  theaters: Film,
  streaming: Monitor,
  netflix: Tv,
  hulu: Tv,

  // Music
  music: Music,
  music_note: Music,
  spotify: Music,
  apple_music: Music,
  headphones: Music,
  concert: Mic,

  // Gaming
  gaming: Gamepad2,
  videogames: Gamepad2,
  videogame_asset: Gamepad2,
  sports_esports: Gamepad2,
  xbox: Gamepad2,
  playstation: Gamepad2,
  nintendo: Gamepad2,

  // Photography
  camera: Camera,
  photography: Camera,

  // Events
  celebration: Gift,
  party: Gift,
  event: Receipt,

  // ===== TECHNOLOGY =====
  // Phones
  phone: Phone,
  mobile: Smartphone,
  smartphone: Smartphone,
  cell_phone: Smartphone,
  iphone: Smartphone,
  android: Smartphone,

  // Computers
  computer: Laptop,
  laptop: Laptop,
  desktop: Monitor,
  pc: Monitor,
  mac: Laptop,

  // Tablets & Wearables
  tablet: Tablet,
  ipad: Tablet,
  watch: Watch,
  smartwatch: Watch,
  apple_watch: Watch,

  // ===== EDUCATION & WORK =====
  education: GraduationCap,
  school: School,
  university: GraduationCap,
  college: GraduationCap,
  tuition: GraduationCap,
  student_loan: GraduationCap,
  work: Briefcase,
  job: Briefcase,
  career: Briefcase,
  daycare: School,
  childcare: Baby,

  // ===== INSURANCE & LEGAL =====
  insurance: Shield,
  life_insurance: Shield,
  health_insurance: Shield,
  auto_insurance: Car,
  home_insurance: Home,
  security: Shield,
  verified_user: Shield,
  policy: Shield,
  shield: Shield,

  // Legal
  legal: Scale,
  lawyer: Scale,
  attorney: Scale,
  law: Scale,
  gavel: Scale,
  balance: Scale,
  contract: FileText,
  document: FileText,

  // Security
  lock: Lock,
  locked: Lock,
  key: Key,

  // ===== PERSONAL CARE =====
  haircut: Scissors,
  salon: Scissors,
  barber: Scissors,
  content_cut: Scissors,
  laundry: Shirt,
  dry_cleaning: Shirt,
  local_laundry_service: Shirt,
  cleaning: Shirt,

  // ===== PETS =====
  pet: Dog,
  pets: Dog,
  dog: Dog,
  cat: Cat,
  veterinarian: PawPrint,
  vet: PawPrint,
  pet_care: PawPrint,

  // ===== FAMILY & PEOPLE =====
  family: Users,
  child_care: Baby,
  baby: Baby,
  kids: Baby,
  children: Baby,
  elderly: Heart,
  senior_care: Heart,
  volunteer_activism: Heart,
  user: User,
  person: User,
  membership: UserPlus,

  // ===== SERVICES & MAINTENANCE =====
  maintenance: Wrench,
  repair: Hammer,
  tools: Hammer,
  handyman: Hammer,
  construction: Drill,
  contractor: Drill,
  painting: PaintBucket,

  // ===== GARDEN & OUTDOOR =====
  garden: Flower,
  gardening: Sprout,
  landscaping: TreePine,
  lawn_care: Leaf,
  tree: TreePine,
  tree_service: TreePine,
  plants: Sprout,

  // ===== WEATHER =====
  sun: Sun,
  sunny: Sun,
  moon: Moon,
  night: Moon,
  cloud: Cloud,
  cloudy: Cloud,
  rain: CloudRain,
  rainy: CloudRain,
  umbrella: Umbrella,

  // ===== GENERAL =====
  favorite: Heart,
  alert: AlertCircle,
  warning: AlertCircle,
  calendar_today: Receipt,
  schedule: Receipt,
  gift: Gift,
  present: Gift,
  leaf: Leaf,

  // ===== LEGACY FOOD/DRINK ICONS (Migration fallbacks to ShoppingCart) =====
  // These icons were removed but are mapped to ShoppingCart for backward compatibility
  restaurant: ShoppingCart,
  dining: ShoppingCart,
  local_dining: ShoppingCart,
  food: ShoppingCart,
  pizza: ShoppingCart,
  local_pizza: ShoppingCart,
  delivery: ShoppingCart,
  coffee: ShoppingCart,
  local_cafe: ShoppingCart,
  cafe: ShoppingCart,
  espresso: ShoppingCart,
  bar: ShoppingCart,
  pub: ShoppingCart,
  local_bar: ShoppingCart,
  wine: ShoppingCart,
  drinks: ShoppingCart,
  winery: ShoppingCart,
  alcohol: ShoppingCart,
  beer: ShoppingCart,
  bakery: ShoppingCart,
  bakery_dining: ShoppingCart,
  cake: ShoppingCart,
  sweets: ShoppingCart,
  dessert: ShoppingCart,
  bottle: ShoppingCart,
  beverages: ShoppingCart,
  local_drink: ShoppingCart,
  fastfood: ShoppingCart,
  nightlife: ShoppingCart,
  glass: ShoppingCart,
  utensils: ShoppingCart,
};

interface BillIconProps {
  icon: string;
  size?: number;
  color?: string;
  containerSize?: number;
  backgroundColor?: string;
}

export const BillIcon = ({ 
  icon, 
  size = 24, 
  color,
  containerSize,
  backgroundColor
}: BillIconProps) => {
  const { colors } = useTheme();
  const IconComponent = iconMap[icon] || iconMap['payment'] || CreditCard;
  
  const iconColor = color || colors.primary;

  if (containerSize) {
    return (
      <View style={{
        width: containerSize,
        height: containerSize,
        borderRadius: containerSize / 4,
        backgroundColor: backgroundColor || colors.primary + '15', // 15 = 10% opacity hex
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <IconComponent size={size} color={iconColor} />
      </View>
    );
  }

  return <IconComponent size={size} color={iconColor} />;
};

// Export unique icon keys
export const availableIcons = Array.from(new Set(Object.values(iconMap))).map(
  (Component) => Object.keys(iconMap).find(key => iconMap[key] === Component) || ''
).filter(Boolean);
