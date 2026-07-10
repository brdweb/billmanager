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
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
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
  categoryKey: string;
}

const icons: IconDefinition[] = [
  // Finance & Banking
  { name: 'credit_card', component: IconCreditCard, categoryKey: 'finance' },
  { name: 'bank', component: IconBuildingBank, categoryKey: 'finance' },
  { name: 'wallet', component: IconWallet, categoryKey: 'finance' },
  { name: 'coin', component: IconCoin, categoryKey: 'finance' },
  { name: 'cash', component: IconCash, categoryKey: 'finance' },
  { name: 'savings', component: IconPigMoney, categoryKey: 'finance' },
  { name: 'loan', component: IconReportMoney, categoryKey: 'finance' },
  { name: 'receipt', component: IconReceipt, categoryKey: 'finance' },
  { name: 'dollar', component: IconCurrencyDollar, categoryKey: 'finance' },
  { name: 'euro', component: IconCurrencyEuro, categoryKey: 'finance' },
  { name: 'pound', component: IconCurrencyPound, categoryKey: 'finance' },
  { name: 'yen', component: IconCurrencyYen, categoryKey: 'finance' },

  // Home & Property
  { name: 'home', component: IconHome, categoryKey: 'property' },
  { name: 'apartment', component: IconBuildingSkyscraper, categoryKey: 'property' },
  { name: 'cottage', component: IconBuildingCottage, categoryKey: 'property' },
  { name: 'parking', component: IconParking, categoryKey: 'property' },
  { name: 'garage', component: IconBuilding, categoryKey: 'property' },
  { name: 'pool', component: IconPool, categoryKey: 'property' },
  { name: 'fence', component: IconFence, categoryKey: 'property' },

  // Utilities
  { name: 'electricity', component: IconBulb, categoryKey: 'utilities' },
  { name: 'water', component: IconDroplet, categoryKey: 'utilities' },
  { name: 'gas', component: IconFlame, categoryKey: 'utilities' },
  { name: 'internet', component: IconWifi, categoryKey: 'utilities' },
  { name: 'cable', component: IconDeviceTv, categoryKey: 'utilities' },
  { name: 'trash', component: IconTrash, categoryKey: 'utilities' },
  { name: 'recycle', component: IconRecycle, categoryKey: 'utilities' },
  { name: 'power', component: IconPlug, categoryKey: 'utilities' },
  { name: 'battery', component: IconBatteryCharging, categoryKey: 'utilities' },
  { name: 'solar', component: IconSolarPanel, categoryKey: 'utilities' },
  { name: 'wind', component: IconWind, categoryKey: 'utilities' },

  // Vehicles
  { name: 'car', component: IconCar, categoryKey: 'vehicles' },
  { name: 'truck', component: IconTruck, categoryKey: 'vehicles' },
  { name: 'rv', component: IconCaravan, categoryKey: 'vehicles' },
  { name: 'motorcycle', component: IconMotorbike, categoryKey: 'vehicles' },
  { name: 'scooter', component: IconScooter, categoryKey: 'vehicles' },
  { name: 'bike', component: IconBike, categoryKey: 'vehicles' },
  { name: 'bus', component: IconBus, categoryKey: 'vehicles' },
  { name: 'flight', component: IconPlane, categoryKey: 'vehicles' },
  { name: 'helicopter', component: IconHelicopter, categoryKey: 'vehicles' },
  { name: 'boat', component: IconSailboat, categoryKey: 'vehicles' },
  { name: 'kayak', component: IconKayak, categoryKey: 'vehicles' },
  { name: 'fuel', component: IconGasStation, categoryKey: 'vehicles' },
  { name: 'car_insurance', component: IconCarCrash, categoryKey: 'vehicles' },
  { name: 'car_wash', component: IconWash, categoryKey: 'vehicles' },

  // Sports & Youth Activities
  { name: 'soccer', component: IconPlayFootball, categoryKey: 'sports' },
  { name: 'football', component: IconBallFootball, categoryKey: 'sports' },
  { name: 'baseball', component: IconBallBaseball, categoryKey: 'sports' },
  { name: 'basketball', component: IconBallBasketball, categoryKey: 'sports' },
  { name: 'tennis', component: IconBallTennis, categoryKey: 'sports' },
  { name: 'volleyball', component: IconBallVolleyball, categoryKey: 'sports' },
  { name: 'bowling', component: IconBallBowling, categoryKey: 'sports' },
  { name: 'golf', component: IconGolf, categoryKey: 'sports' },
  { name: 'swimming', component: IconSwimming, categoryKey: 'sports' },
  { name: 'ice_skating', component: IconIceSkating, categoryKey: 'sports' },
  { name: 'skiing', component: IconSkiJumping, categoryKey: 'sports' },
  { name: 'gymnastics', component: IconGymnastics, categoryKey: 'sports' },
  { name: 'running', component: IconRun, categoryKey: 'sports' },
  { name: 'gym', component: IconBarbell, categoryKey: 'sports' },
  { name: 'trophy', component: IconTrophy, categoryKey: 'sports' },
  { name: 'medal', component: IconMedal, categoryKey: 'sports' },
  { name: 'award', component: IconAward, categoryKey: 'sports' },

  // Healthcare & Medical
  { name: 'healthcare', component: IconHeartbeat, categoryKey: 'medical' },
  { name: 'heart_monitor', component: IconHeartRateMonitor, categoryKey: 'medical' },
  { name: 'pharmacy', component: IconPill, categoryKey: 'medical' },
  { name: 'vaccine', component: IconVaccine, categoryKey: 'medical' },
  { name: 'dental', component: IconDental, categoryKey: 'medical' },
  { name: 'doctor', component: IconStethoscope, categoryKey: 'medical' },
  { name: 'ambulance', component: IconAmbulance, categoryKey: 'medical' },
  { name: 'first_aid', component: IconFirstAidKit, categoryKey: 'medical' },
  { name: 'bandage', component: IconBandage, categoryKey: 'medical' },
  { name: 'thermometer', component: IconThermometer, categoryKey: 'medical' },
  { name: 'vision', component: IconEye, categoryKey: 'medical' },
  { name: 'glasses', component: IconEyeglass, categoryKey: 'medical' },
  { name: 'disability', component: IconDisabled, categoryKey: 'medical' },
  { name: 'wellness', component: IconLeaf, categoryKey: 'medical' },

  // Shopping
  { name: 'groceries', component: IconShoppingCart, categoryKey: 'shopping' },

  // Entertainment & Media
  { name: 'streaming', component: IconMovie, categoryKey: 'entertainment' },
  { name: 'music', component: IconMusic, categoryKey: 'entertainment' },
  { name: 'gaming', component: IconDeviceGamepad2, categoryKey: 'entertainment' },
  { name: 'books', component: IconBook, categoryKey: 'entertainment' },
  { name: 'newspaper', component: IconNotebook, categoryKey: 'entertainment' },
  { name: 'gift', component: IconGift, categoryKey: 'entertainment' },

  // Technology & Devices
  { name: 'phone', component: IconPhone, categoryKey: 'technology' },
  { name: 'mobile', component: IconDeviceMobile, categoryKey: 'technology' },
  { name: 'laptop', component: IconDeviceLaptop, categoryKey: 'technology' },
  { name: 'desktop', component: IconDeviceDesktop, categoryKey: 'technology' },
  { name: 'watch', component: IconDeviceWatch, categoryKey: 'technology' },
  { name: 'headphones', component: IconHeadphones, categoryKey: 'technology' },
  { name: 'keyboard', component: IconKeyboard, categoryKey: 'technology' },
  { name: 'mouse', component: IconMouse, categoryKey: 'technology' },
  { name: 'printer', component: IconPrinter, categoryKey: 'technology' },
  { name: 'router', component: IconRouter, categoryKey: 'technology' },

  // Work & Education
  { name: 'school', component: IconSchool, categoryKey: 'education' },
  { name: 'backpack', component: IconBackpack, categoryKey: 'education' },
  { name: 'certificate', component: IconCertificate, categoryKey: 'education' },
  { name: 'pencil', component: IconPencil, categoryKey: 'education' },
  { name: 'work', component: IconBriefcase, categoryKey: 'education' },
  { name: 'business', component: IconBuilding, categoryKey: 'education' },

  // Insurance & Legal
  { name: 'insurance', component: IconShield, categoryKey: 'insurance' },
  { name: 'security', component: IconLock, categoryKey: 'insurance' },
  { name: 'legal', component: IconFileText, categoryKey: 'insurance' },
  { name: 'tax', component: IconFileSpreadsheet, categoryKey: 'insurance' },

  // Personal Care & Services
  { name: 'haircut', component: IconCut, categoryKey: 'personal' },
  { name: 'salon', component: IconSpray, categoryKey: 'personal' },

  // Pets
  { name: 'dog', component: IconDog, categoryKey: 'pets' },
  { name: 'cat', component: IconCat, categoryKey: 'pets' },
  { name: 'pet', component: IconPaw, categoryKey: 'pets' },
  { name: 'pet_food', component: IconBone, categoryKey: 'pets' },

  // Family & Childcare
  { name: 'childcare', component: IconBabyCarriage, categoryKey: 'family' },

  // Home Services & Maintenance
  { name: 'repairs', component: IconHammer, categoryKey: 'services' },
  { name: 'ladder', component: IconLadder, categoryKey: 'services' },
  { name: 'tools', component: IconHammer, categoryKey: 'services' },
  { name: 'chopping', component: IconAxe, categoryKey: 'services' },
  { name: 'digging', component: IconShovel, categoryKey: 'services' },
  { name: 'painting', component: IconPaint, categoryKey: 'services' },
  { name: 'brush', component: IconBrush, categoryKey: 'services' },

  // Garden & Lawn
  { name: 'tree', component: IconTree, categoryKey: 'garden' },
  { name: 'flowers', component: IconFlower, categoryKey: 'garden' },
  { name: 'plants', component: IconPlant, categoryKey: 'garden' },
  { name: 'lawn', component: IconGardenCart, categoryKey: 'garden' },

  // Weather & Misc
  { name: 'sun', component: IconSun, categoryKey: 'misc' },
  { name: 'moon', component: IconMoon, categoryKey: 'misc' },
  { name: 'cloud', component: IconCloud, categoryKey: 'misc' },
  { name: 'umbrella', component: IconUmbrella, categoryKey: 'misc' },
];

const categoryKeys = [
  'all',
  'finance',
  'property',
  'utilities',
  'vehicles',
  'sports',
  'medical',
  'shopping',
  'entertainment',
  'technology',
  'education',
  'insurance',
  'personal',
  'pets',
  'family',
  'services',
  'garden',
  'misc',
];

function iconLabel(name: string, t: TFunction): string {
  return t(`iconPicker.icons.${name}`);
}

function categoryLabel(key: string, t: TFunction): string {
  return t(`iconPicker.categories.${key}`);
}

interface IconPickerProps {
  opened: boolean;
  onClose: () => void;
  onSelect: (iconName: string) => void;
  currentIcon?: string;
}

export function IconPicker({ opened, onClose, onSelect, currentIcon }: IconPickerProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');

  const filteredIcons = useMemo(() => {
    return icons.filter((icon) => {
      const label = iconLabel(icon.name, t);
      const matchesSearch =
        search === '' ||
        label.toLowerCase().includes(search.toLowerCase()) ||
        icon.name.toLowerCase().includes(search.toLowerCase());
      const matchesCategory = activeCategory === 'all' || icon.categoryKey === activeCategory;
      return matchesSearch && matchesCategory;
    });
  }, [search, activeCategory, t]);

  const handleSelect = (iconName: string) => {
    onSelect(iconName);
    onClose();
    setSearch('');
    setActiveCategory('all');
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={t('iconPicker.title')}
      size="lg"
      centered
    >
      <Stack gap="md">
        <TextInput
          placeholder={t('iconPicker.searchPlaceholder')}
          leftSection={<IconSearch size={16} />}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
        />

        <Tabs value={activeCategory} onChange={(val) => setActiveCategory(val || 'all')}>
          <Tabs.List>
            {categoryKeys.slice(0, 6).map((key) => (
              <Tabs.Tab key={key} value={key}>
                {categoryLabel(key, t)}
              </Tabs.Tab>
            ))}
          </Tabs.List>
          <Tabs.List>
            {categoryKeys.slice(6).map((key) => (
              <Tabs.Tab key={key} value={key}>
                {categoryLabel(key, t)}
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
                <Tooltip key={icon.name} label={iconLabel(icon.name, t)} position="top">
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
              {t('iconPicker.noIconsFound', { search })}
            </Text>
          )}
        </ScrollArea>
      </Stack>
    </Modal>
  );
}
