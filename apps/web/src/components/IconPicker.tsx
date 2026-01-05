import { useState, useMemo } from 'react';
import {
  Modal,
  TextInput,
  SimpleGrid,
  ActionIcon,
  Text,
  Stack,
  Tabs,
  ScrollArea,
  Tooltip,
} from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';
import {
  // Finance & Banking
  IconCreditCard,
  IconBuildingBank,
  IconWallet,
  IconCoin,
  IconCash,
  IconPigMoney,
  IconReportMoney,
  IconReceipt,
  IconCurrencyDollar,
  IconCurrencyEuro,
  IconCurrencyPound,
  IconCurrencyYen,

  // Home & Property
  IconHome,
  IconBuildingSkyscraper,
  IconBuildingCottage,
  IconParking,
  IconPool,
  IconFence,
  IconLadder,

  // Utilities
  IconBulb,
  IconDroplet,
  IconFlame,
  IconWifi,
  IconDeviceTv,
  IconTrash,
  IconRecycle,
  IconPlug,
  IconBatteryCharging,
  IconSolarPanel,
  IconWind,

  // Vehicles
  IconCar,
  IconTruck,
  IconCaravan,
  IconMotorbike,
  IconScooter,
  IconBike,
  IconBus,
  IconPlane,
  IconHelicopter,
  IconSailboat,
  IconKayak,
  IconGasStation,
  IconCarCrash,
  IconWash,

  // Sports & Activities (Kids)
  IconBallFootball,
  IconBallBaseball,
  IconBallBasketball,
  IconBallTennis,
  IconBallVolleyball,
  IconBallBowling,
  IconPlayFootball,
  IconGolf,
  IconSwimming,
  IconIceSkating,
  IconSkiJumping,
  IconGymnastics,
  IconRun,
  IconBarbell,
  IconTrophy,
  IconMedal,
  IconAward,

  // Healthcare & Medical
  IconHeartbeat,
  IconHeartRateMonitor,
  IconPill,
  IconVaccine,
  IconDental,
  IconStethoscope,
  IconAmbulance,
  IconFirstAidKit,
  IconBandage,
  IconThermometer,
  IconEye,
  IconEyeglass,
  IconDisabled,

  // Shopping
  IconShoppingCart,

  // Entertainment & Media
  IconMovie,
  IconMusic,
  IconDeviceGamepad2,
  IconBook,
  IconBackpack,
  IconNotebook,

  // Technology
  IconPhone,
  IconDeviceMobile,
  IconDeviceLaptop,
  IconDeviceDesktop,
  IconDeviceWatch,
  IconHeadphones,
  IconKeyboard,
  IconMouse,
  IconPrinter,
  IconRouter,

  // Work & Education
  IconSchool,
  IconBriefcase,
  IconBuilding,
  IconCertificate,
  IconPencil,

  // Insurance & Legal
  IconShield,
  IconLock,
  IconFileText,
  IconFileSpreadsheet,

  // Personal Care & Services
  IconCut,
  IconSpray,
  IconLeaf,

  // Pets
  IconDog,
  IconCat,
  IconPaw,
  IconBone,

  // Childcare & Family
  IconBabyCarriage,

  // Home Services & Maintenance
  IconHammer,
  IconAxe,
  IconShovel,
  IconPaint,
  IconBrush,

  // Garden & Outdoor
  IconTree,
  IconFlower,
  IconPlant,
  IconGardenCart,

  // Misc
  IconGift,
  IconSun,
  IconMoon,
  IconCloud,
  IconUmbrella,
} from '@tabler/icons-react';
import type { IconProps } from '@tabler/icons-react';

interface IconDefinition {
  name: string;
  component: React.ComponentType<IconProps>;
  label: string;
  category: string;
}

const icons: IconDefinition[] = [
  // Finance & Banking
  { name: 'credit_card', component: IconCreditCard, label: 'Credit Card', category: 'Finance' },
  { name: 'bank', component: IconBuildingBank, label: 'Bank', category: 'Finance' },
  { name: 'wallet', component: IconWallet, label: 'Wallet', category: 'Finance' },
  { name: 'coin', component: IconCoin, label: 'Coin/Money', category: 'Finance' },
  { name: 'cash', component: IconCash, label: 'Cash', category: 'Finance' },
  { name: 'savings', component: IconPigMoney, label: 'Savings', category: 'Finance' },
  { name: 'loan', component: IconReportMoney, label: 'Loan/Investment', category: 'Finance' },
  { name: 'receipt', component: IconReceipt, label: 'Receipt/Bill', category: 'Finance' },
  { name: 'dollar', component: IconCurrencyDollar, label: 'US Dollar', category: 'Finance' },
  { name: 'euro', component: IconCurrencyEuro, label: 'Euro', category: 'Finance' },
  { name: 'pound', component: IconCurrencyPound, label: 'British Pound', category: 'Finance' },
  { name: 'yen', component: IconCurrencyYen, label: 'Yen/Yuan', category: 'Finance' },

  // Home & Property
  { name: 'home', component: IconHome, label: 'Home/Mortgage', category: 'Property' },
  { name: 'apartment', component: IconBuildingSkyscraper, label: 'Apartment/Condo', category: 'Property' },
  { name: 'cottage', component: IconBuildingCottage, label: 'Cottage/Cabin', category: 'Property' },
  { name: 'parking', component: IconParking, label: 'Parking/HOA', category: 'Property' },
  { name: 'garage', component: IconBuilding, label: 'Garage/Storage', category: 'Property' },
  { name: 'pool', component: IconPool, label: 'Pool Maintenance', category: 'Property' },
  { name: 'fence', component: IconFence, label: 'Fence/Security', category: 'Property' },

  // Utilities
  { name: 'electricity', component: IconBulb, label: 'Electricity', category: 'Utilities' },
  { name: 'water', component: IconDroplet, label: 'Water/Sewer', category: 'Utilities' },
  { name: 'gas', component: IconFlame, label: 'Gas/Heating', category: 'Utilities' },
  { name: 'internet', component: IconWifi, label: 'Internet/WiFi', category: 'Utilities' },
  { name: 'cable', component: IconDeviceTv, label: 'Cable/Streaming', category: 'Utilities' },
  { name: 'trash', component: IconTrash, label: 'Trash/Waste', category: 'Utilities' },
  { name: 'recycle', component: IconRecycle, label: 'Recycling', category: 'Utilities' },
  { name: 'power', component: IconPlug, label: 'Electric/Power', category: 'Utilities' },
  { name: 'battery', component: IconBatteryCharging, label: 'Battery/Charging', category: 'Utilities' },
  { name: 'solar', component: IconSolarPanel, label: 'Solar Power', category: 'Utilities' },
  { name: 'wind', component: IconWind, label: 'Wind Power', category: 'Utilities' },

  // Vehicles
  { name: 'car', component: IconCar, label: 'Car Payment', category: 'Vehicles' },
  { name: 'truck', component: IconTruck, label: 'Truck', category: 'Vehicles' },
  { name: 'rv', component: IconCaravan, label: 'RV/Camper', category: 'Vehicles' },
  { name: 'motorcycle', component: IconMotorbike, label: 'Motorcycle', category: 'Vehicles' },
  { name: 'scooter', component: IconScooter, label: 'Scooter/Moped', category: 'Vehicles' },
  { name: 'bike', component: IconBike, label: 'Bicycle', category: 'Vehicles' },
  { name: 'bus', component: IconBus, label: 'Bus/Transit', category: 'Vehicles' },
  { name: 'flight', component: IconPlane, label: 'Flight/Travel', category: 'Vehicles' },
  { name: 'helicopter', component: IconHelicopter, label: 'Helicopter', category: 'Vehicles' },
  { name: 'boat', component: IconSailboat, label: 'Boat/Yacht', category: 'Vehicles' },
  { name: 'kayak', component: IconKayak, label: 'Kayak/Canoe', category: 'Vehicles' },
  { name: 'fuel', component: IconGasStation, label: 'Gas/Fuel', category: 'Vehicles' },
  { name: 'car_insurance', component: IconCarCrash, label: 'Auto Insurance', category: 'Vehicles' },
  { name: 'car_wash', component: IconWash, label: 'Car Wash', category: 'Vehicles' },

  // Sports & Youth Activities
  { name: 'soccer', component: IconPlayFootball, label: 'Soccer', category: 'Sports' },
  { name: 'football', component: IconBallFootball, label: 'Football', category: 'Sports' },
  { name: 'baseball', component: IconBallBaseball, label: 'Baseball', category: 'Sports' },
  { name: 'basketball', component: IconBallBasketball, label: 'Basketball', category: 'Sports' },
  { name: 'tennis', component: IconBallTennis, label: 'Tennis', category: 'Sports' },
  { name: 'volleyball', component: IconBallVolleyball, label: 'Volleyball', category: 'Sports' },
  { name: 'bowling', component: IconBallBowling, label: 'Bowling', category: 'Sports' },
  { name: 'golf', component: IconGolf, label: 'Golf', category: 'Sports' },
  { name: 'swimming', component: IconSwimming, label: 'Swimming Lessons', category: 'Sports' },
  { name: 'ice_skating', component: IconIceSkating, label: 'Ice Skating', category: 'Sports' },
  { name: 'skiing', component: IconSkiJumping, label: 'Skiing', category: 'Sports' },
  { name: 'gymnastics', component: IconGymnastics, label: 'Gymnastics', category: 'Sports' },
  { name: 'running', component: IconRun, label: 'Running/Track', category: 'Sports' },
  { name: 'gym', component: IconBarbell, label: 'Gym Membership', category: 'Sports' },
  { name: 'trophy', component: IconTrophy, label: 'Competition/Team', category: 'Sports' },
  { name: 'medal', component: IconMedal, label: 'Medal/Award', category: 'Sports' },
  { name: 'award', component: IconAward, label: 'Award/Trophy', category: 'Sports' },

  // Healthcare & Medical
  { name: 'healthcare', component: IconHeartbeat, label: 'Health Insurance', category: 'Medical' },
  { name: 'heart_monitor', component: IconHeartRateMonitor, label: 'Heart Monitor', category: 'Medical' },
  { name: 'pharmacy', component: IconPill, label: 'Pharmacy/Rx', category: 'Medical' },
  { name: 'vaccine', component: IconVaccine, label: 'Vaccine/Shot', category: 'Medical' },
  { name: 'dental', component: IconDental, label: 'Dental', category: 'Medical' },
  { name: 'doctor', component: IconStethoscope, label: 'Doctor Visit', category: 'Medical' },
  { name: 'ambulance', component: IconAmbulance, label: 'Ambulance/Emergency', category: 'Medical' },
  { name: 'first_aid', component: IconFirstAidKit, label: 'First Aid', category: 'Medical' },
  { name: 'bandage', component: IconBandage, label: 'Bandage/Wound Care', category: 'Medical' },
  { name: 'thermometer', component: IconThermometer, label: 'Thermometer', category: 'Medical' },
  { name: 'vision', component: IconEye, label: 'Vision/Eye', category: 'Medical' },
  { name: 'glasses', component: IconEyeglass, label: 'Glasses/Contacts', category: 'Medical' },
  { name: 'disability', component: IconDisabled, label: 'Disability/Accessibility', category: 'Medical' },
  { name: 'wellness', component: IconLeaf, label: 'Wellness/Spa', category: 'Medical' },

  // Shopping
  { name: 'groceries', component: IconShoppingCart, label: 'Groceries', category: 'Shopping' },

  // Entertainment & Media
  { name: 'streaming', component: IconMovie, label: 'Streaming Service', category: 'Entertainment' },
  { name: 'music', component: IconMusic, label: 'Music Streaming', category: 'Entertainment' },
  { name: 'gaming', component: IconDeviceGamepad2, label: 'Gaming', category: 'Entertainment' },
  { name: 'books', component: IconBook, label: 'Books/Magazines', category: 'Entertainment' },
  { name: 'newspaper', component: IconNotebook, label: 'Newspaper', category: 'Entertainment' },
  { name: 'gift', component: IconGift, label: 'Gift/Subscription', category: 'Entertainment' },

  // Technology & Devices
  { name: 'phone', component: IconPhone, label: 'Phone Service', category: 'Technology' },
  { name: 'mobile', component: IconDeviceMobile, label: 'Mobile Phone', category: 'Technology' },
  { name: 'laptop', component: IconDeviceLaptop, label: 'Laptop', category: 'Technology' },
  { name: 'desktop', component: IconDeviceDesktop, label: 'Desktop Computer', category: 'Technology' },
  { name: 'watch', component: IconDeviceWatch, label: 'Smartwatch', category: 'Technology' },
  { name: 'headphones', component: IconHeadphones, label: 'Headphones/Audio', category: 'Technology' },
  { name: 'keyboard', component: IconKeyboard, label: 'Keyboard', category: 'Technology' },
  { name: 'mouse', component: IconMouse, label: 'Mouse', category: 'Technology' },
  { name: 'printer', component: IconPrinter, label: 'Printer', category: 'Technology' },
  { name: 'router', component: IconRouter, label: 'Router/Modem', category: 'Technology' },

  // Work & Education
  { name: 'school', component: IconSchool, label: 'School/Tuition', category: 'Education' },
  { name: 'backpack', component: IconBackpack, label: 'School Supplies', category: 'Education' },
  { name: 'certificate', component: IconCertificate, label: 'Certification', category: 'Education' },
  { name: 'pencil', component: IconPencil, label: 'Supplies', category: 'Education' },
  { name: 'work', component: IconBriefcase, label: 'Work/Professional', category: 'Education' },
  { name: 'business', component: IconBuilding, label: 'Business/Office', category: 'Education' },

  // Insurance & Legal
  { name: 'insurance', component: IconShield, label: 'Insurance', category: 'Insurance' },
  { name: 'security', component: IconLock, label: 'Security System', category: 'Insurance' },
  { name: 'legal', component: IconFileText, label: 'Legal/Attorney', category: 'Insurance' },
  { name: 'tax', component: IconFileSpreadsheet, label: 'Tax/Accounting', category: 'Insurance' },

  // Personal Care & Services
  { name: 'haircut', component: IconCut, label: 'Haircut/Salon', category: 'Personal' },
  { name: 'salon', component: IconSpray, label: 'Salon/Spa', category: 'Personal' },

  // Pets
  { name: 'dog', component: IconDog, label: 'Dog', category: 'Pets' },
  { name: 'cat', component: IconCat, label: 'Cat', category: 'Pets' },
  { name: 'pet', component: IconPaw, label: 'Pet/Vet', category: 'Pets' },
  { name: 'pet_food', component: IconBone, label: 'Pet Food', category: 'Pets' },

  // Family & Childcare
  { name: 'childcare', component: IconBabyCarriage, label: 'Childcare/Daycare', category: 'Family' },

  // Home Services & Maintenance
  { name: 'repairs', component: IconHammer, label: 'Home Repairs', category: 'Services' },
  { name: 'ladder', component: IconLadder, label: 'Ladder/Roofing', category: 'Services' },
  { name: 'tools', component: IconHammer, label: 'Tools/Equipment', category: 'Services' },
  { name: 'chopping', component: IconAxe, label: 'Tree Service', category: 'Services' },
  { name: 'digging', component: IconShovel, label: 'Landscaping', category: 'Services' },
  { name: 'painting', component: IconPaint, label: 'Painting', category: 'Services' },
  { name: 'brush', component: IconBrush, label: 'Cleaning', category: 'Services' },

  // Garden & Lawn
  { name: 'tree', component: IconTree, label: 'Tree/Landscape', category: 'Garden' },
  { name: 'flowers', component: IconFlower, label: 'Flowers', category: 'Garden' },
  { name: 'plants', component: IconPlant, label: 'Plants/Garden', category: 'Garden' },
  { name: 'lawn', component: IconGardenCart, label: 'Lawn Care', category: 'Garden' },

  // Weather & Misc
  { name: 'sun', component: IconSun, label: 'Solar/Sun', category: 'Misc' },
  { name: 'moon', component: IconMoon, label: 'Night/Moon', category: 'Misc' },
  { name: 'cloud', component: IconCloud, label: 'Cloud Storage', category: 'Misc' },
  { name: 'umbrella', component: IconUmbrella, label: 'Umbrella Insurance', category: 'Misc' },
];

const categories = [
  'All',
  'Finance',
  'Property',
  'Utilities',
  'Vehicles',
  'Sports',
  'Medical',
  'Shopping',
  'Entertainment',
  'Technology',
  'Education',
  'Insurance',
  'Personal',
  'Pets',
  'Family',
  'Services',
  'Garden',
  'Misc',
];

interface IconPickerProps {
  opened: boolean;
  onClose: () => void;
  onSelect: (iconName: string) => void;
  currentIcon?: string;
}

export function IconPicker({ opened, onClose, onSelect, currentIcon }: IconPickerProps) {
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');

  const filteredIcons = useMemo(() => {
    return icons.filter((icon) => {
      const matchesSearch =
        search === '' ||
        icon.label.toLowerCase().includes(search.toLowerCase()) ||
        icon.name.toLowerCase().includes(search.toLowerCase());
      const matchesCategory = activeCategory === 'All' || icon.category === activeCategory;
      return matchesSearch && matchesCategory;
    });
  }, [search, activeCategory]);

  const handleSelect = (iconName: string) => {
    onSelect(iconName);
    onClose();
    setSearch('');
    setActiveCategory('All');
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Choose an Icon"
      size="lg"
      centered
    >
      <Stack gap="md">
        <TextInput
          placeholder="Search icons..."
          leftSection={<IconSearch size={16} />}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
        />

        <Tabs value={activeCategory} onChange={(val) => setActiveCategory(val || 'All')}>
          <Tabs.List>
            {categories.slice(0, 6).map((cat) => (
              <Tabs.Tab key={cat} value={cat}>
                {cat}
              </Tabs.Tab>
            ))}
          </Tabs.List>
          <Tabs.List>
            {categories.slice(6).map((cat) => (
              <Tabs.Tab key={cat} value={cat}>
                {cat}
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs>

        <ScrollArea h={300}>
          <SimpleGrid cols={6} spacing="xs">
            {filteredIcons.map((icon) => {
              const IconComponent = icon.component;
              const isSelected = icon.name === currentIcon;
              return (
                <Tooltip key={icon.name} label={icon.label} position="top">
                  <ActionIcon
                    variant={isSelected ? 'filled' : 'light'}
                    color={isSelected ? 'violet' : 'gray'}
                    size="xl"
                    onClick={() => handleSelect(icon.name)}
                  >
                    <IconComponent size={24} />
                  </ActionIcon>
                </Tooltip>
              );
            })}
          </SimpleGrid>

          {filteredIcons.length === 0 && (
            <Text c="dimmed" ta="center" py="xl">
              No icons found matching "{search}"
            </Text>
          )}
        </ScrollArea>
      </Stack>
    </Modal>
  );
}
