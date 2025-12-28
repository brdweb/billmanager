import {
  IconCreditCard,
  IconHome,
  IconBulb,
  IconDroplet,
  IconFlame,
  IconWifi,
  IconCar,
  IconGasStation,
  IconShoppingCart,
  IconToolsKitchen2,
  IconPill,
  IconHeartbeat,
  IconDeviceTv,
  IconMusic,
  IconMovie,
  IconDeviceGamepad2,
  IconPhone,
  IconSchool,
  IconBuildingBank,
  IconReceipt,
  IconWallet,
  IconCoin,
  IconCash,
  IconPigMoney,
  IconReportMoney,
  IconShield,
  IconLock,
  IconBriefcase,
  IconBuilding,
  IconPlane,
  IconBus,
  IconBike,
  IconRun,
  IconSwimming,
  IconBarbell,
  IconCut,
  IconDog,
  IconCat,
  IconBabyCarriage,
  IconGift,
  IconCake,
  IconBottle,
  IconCoffee,
  IconPizza,
  IconBeer,
  IconGlassFull,
  IconSun,
  IconMoon,
  IconCloud,
  IconUmbrella,
  IconTree,
  IconLeaf,
  IconBallFootball,
  IconBallBaseball,
  IconBallBasketball,
  IconBallTennis,
  IconBallVolleyball,
  IconPlayFootball,
  IconGolf,
  IconTrophy,
} from '@tabler/icons-react';
import type { IconProps } from '@tabler/icons-react';
import { ThemeIcon, useMantineTheme } from '@mantine/core';

// Map of icon names to Tabler icon components
const iconMap: Record<string, React.ComponentType<IconProps>> = {
  // Payment & Finance
  payment: IconCreditCard,
  credit_card: IconCreditCard,
  account_balance: IconBuildingBank,
  account_balance_wallet: IconWallet,
  attach_money: IconCoin,
  monetization_on: IconCash,
  savings: IconPigMoney,
  currency_exchange: IconReportMoney,
  receipt: IconReceipt,

  // Utilities & Home
  home: IconHome,
  lightbulb: IconBulb,
  power: IconBulb,
  electrical_services: IconBulb,
  water_drop: IconDroplet,
  local_fire_department: IconFlame,
  ac_unit: IconSun,
  thermostat: IconFlame,
  wifi: IconWifi,
  router: IconWifi,
  cable: IconDeviceTv,
  satellite: IconDeviceTv,

  // Transportation
  directions_car: IconCar,
  local_gas_station: IconGasStation,
  car_repair: IconCar,
  train: IconBus,
  bus: IconBus,
  flight: IconPlane,
  local_shipping: IconBus,
  motorcycle: IconBike,
  pedal_bike: IconBike,
  taxi: IconCar,
  uber: IconCar,
  local_parking: IconCar,

  // Shopping
  shopping_cart: IconShoppingCart,
  shopping_bag: IconShoppingCart,
  store: IconBuilding,
  local_grocery_store: IconShoppingCart,
  local_mall: IconBuilding,
  storefront: IconBuilding,

  // Food & Dining
  restaurant: IconToolsKitchen2,
  local_dining: IconToolsKitchen2,
  local_pizza: IconPizza,
  local_cafe: IconCoffee,
  local_bar: IconBeer,
  fastfood: IconPizza,
  bakery_dining: IconCake,
  coffee: IconCoffee,

  // Healthcare
  medical_services: IconHeartbeat,
  local_hospital: IconHeartbeat,
  local_pharmacy: IconPill,
  fitness_center: IconBarbell,
  spa: IconLeaf,
  healing: IconHeartbeat,
  vaccines: IconPill,
  medication: IconPill,

  // Entertainment
  movie: IconMovie,
  theaters: IconMovie,
  music_note: IconMusic,
  headphones: IconMusic,
  tv: IconDeviceTv,
  videogame_asset: IconDeviceGamepad2,
  sports_esports: IconDeviceGamepad2,
  nightlife: IconGlassFull,
  celebration: IconGift,

  // Technology
  phone: IconPhone,
  smartphone: IconPhone,
  computer: IconDeviceTv,
  laptop: IconDeviceTv,
  tablet: IconDeviceTv,
  watch: IconPhone,

  // Education & Work
  school: IconSchool,
  work: IconBriefcase,
  business: IconBuilding,
  corporate_fare: IconBuilding,
  apartment: IconBuilding,
  domain: IconBuilding,

  // Sports & Recreation
  soccer: IconPlayFootball,
  football: IconBallFootball,
  baseball: IconBallBaseball,
  basketball: IconBallBasketball,
  tennis: IconBallTennis,
  volleyball: IconBallVolleyball,
  golf: IconGolf,
  trophy: IconTrophy,
  sports_soccer: IconPlayFootball,
  sports_basketball: IconBallBasketball,
  sports_tennis: IconBallTennis,
  golf_course: IconGolf,
  pool: IconSwimming,
  beach_access: IconSun,
  camping: IconTree,
  hiking: IconRun,
  kayaking: IconSwimming,

  // Personal Care
  content_cut: IconCut,
  dry_cleaning: IconCut,
  local_laundry_service: IconCut,

  // Insurance & Legal
  security: IconShield,
  gavel: IconShield,
  balance: IconShield,
  verified_user: IconShield,
  policy: IconShield,
  shield: IconShield,
  lock: IconLock,
  key: IconLock,

  // Pets
  pets: IconDog,
  pet: IconDog,
  dog: IconDog,
  cat: IconCat,

  // Misc
  child_care: IconBabyCarriage,
  elderly: IconHeartbeat,
  volunteer_activism: IconHeartbeat,
  favorite: IconHeartbeat,
  cake: IconCake,
  gift: IconGift,
  event: IconReceipt,
  calendar_today: IconReceipt,
  schedule: IconReceipt,
  local_drink: IconBottle,
  beer: IconBeer,
  wine: IconGlassFull,
  glass: IconGlassFull,

  // Weather/Nature
  sun: IconSun,
  moon: IconMoon,
  cloud: IconCloud,
  umbrella: IconUmbrella,
  tree: IconTree,
  leaf: IconLeaf,
};

interface BillIconProps {
  icon: string;
  size?: number;
  withBackground?: boolean;
}

export function BillIcon({ icon, size = 20, withBackground = false }: BillIconProps) {
  const theme = useMantineTheme();
  const IconComponent = iconMap[icon] || iconMap['payment'] || IconCreditCard;

  if (withBackground) {
    return (
      <ThemeIcon size={size + 12} radius="md" variant="light" color="violet">
        <IconComponent size={size} />
      </ThemeIcon>
    );
  }

  return <IconComponent size={size} color={theme.colors.violet[6]} />;
}

// Export the icon map for the icon picker
// eslint-disable-next-line react-refresh/only-export-components
export const availableIcons = Object.keys(iconMap);
