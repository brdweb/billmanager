# BillManager Mobile - Store Submission Guide

**Version:** 1.0.0  
**Bundle ID (iOS):** com.brdweb.billmanager  
**Package Name (Android):** com.brdweb.billmanagermobile  
**EAS Project ID:** 061766ea-b874-4027-bcbb-a24b395cb8b6

---

## 📋 Pre-Submission Checklist

### ✅ Already Complete
- [x] App icon (512x512 and adaptive)
- [x] Splash screen
- [x] Bundle identifiers configured
- [x] EAS project created
- [x] Push notifications configured

### 🔧 Configuration Needed

#### Apple App Store Connect
- [ ] Apple Developer Account ($99/year)
- [ ] App Store Connect app created
- [ ] Fill in `eas.json` submit.production.ios fields:
  - `appleId`: Your Apple ID email
  - `ascAppId`: App Store Connect app ID (get after creating app)
  - `appleTeamId`: Developer Team ID

#### Google Play Console
- [ ] Google Play Developer Account ($25 one-time)
- [ ] Create app in Play Console
- [ ] Configure app signing (Play App Signing recommended)

---

## 📱 App Store Requirements

### 1. App Metadata

#### App Name & Description
**Name:** BillManager - Track Bills & Income  
**Subtitle (iOS):** Smart Financial Tracker

**Short Description (Android, 80 chars):**
Track recurring bills and income. Forecast cash flow with confidence.

**Full Description (both stores, 4000 chars max):**
```
BillManager helps you stay on top of your recurring expenses and income with intelligent forecasting and payment tracking.

KEY FEATURES:

📊 Smart Dashboard
• Visual overview of upcoming bills
• Cash flow forecasting
• Payment analytics and trends

💰 Income & Expense Tracking
• Track both bills and deposits
• Multiple accounts and bill groups
• Flexible payment schedules (weekly, monthly, custom)

🔔 Payment Reminders
• Never miss a due date
• Push notifications for upcoming bills
• Automatic payment processing

📈 Analytics & Insights
• Visual charts and payment history
• Monthly spending patterns
• Account-based filtering

🔒 Secure & Private
• Two-factor authentication
• Social login (Google, Apple, Microsoft)
• Self-hosted option available

👥 Bill Sharing
• Share bills with family or roommates
• Split costs by percentage or fixed amount
• Track individual payment status

✨ Modern Design
• Dark mode support
• Intuitive interface
• Offline support with sync

Perfect for individuals, families, or small businesses tracking recurring finances.

LEARN MORE:
Website: https://billmanager.app (or your domain)
Documentation: https://docs.billmanager.app
Source Code: https://github.com/brdweb/billmanager (O'Saasy License)
```

#### Keywords (iOS, 100 chars)
```
bill tracker,expense manager,budget planner,payment reminder,finance,cash flow,recurring bills
```

#### Categories
- **Primary:** Finance
- **Secondary:** Productivity

### 2. Screenshots Required

#### iOS (iPhone 6.7" / iPhone 6.5")
- [ ] 1290 x 2796 px (iPhone 15 Pro Max) - **Required 3-10 screenshots**
  1. Dashboard view (showing upcoming bills)
  2. Bill list with filters
  3. Add/Edit bill screen
  4. Analytics/Stats screen
  5. Payment history
  6. Settings/Profile (optional)

#### Android (Phone)
- [ ] 1080 x 2340 px minimum - **Required 2-8 screenshots**
  - Same screens as iOS

**Screenshot Tips:**
- Use light mode for better visibility
- Show realistic data (not lorem ipsum)
- Highlight key features
- Add captions/annotations if helpful
- Use device frames (optional but professional)

### 3. Promotional Graphics

#### iOS App Store
- [ ] **App Preview Video** (optional but recommended, 15-30 seconds)

#### Google Play Store
- [ ] **Feature Graphic** - 1024 x 500 px (required)
- [ ] **Promo Video** (YouTube link, optional)

### 4. Privacy & Legal

#### Privacy Policy (REQUIRED)
- [ ] Create privacy policy at https://yourdomain.com/privacy
- [ ] Must cover:
  - What data you collect (email, billing data, device info)
  - How data is used (app functionality, authentication)
  - Third-party services (push notifications, analytics if any)
  - Data retention
  - User rights (deletion, export)
  - Contact information

#### Terms of Service
- [ ] Create terms at https://yourdomain.com/terms
- [ ] Cover:
  - License terms (O'Saasy)
  - Acceptable use
  - Disclaimer of warranties
  - Limitation of liability

#### App Privacy Details (iOS)
Must declare in App Store Connect:
- **Data Linked to User:**
  - Email address
  - Financial info (bill amounts, due dates)
  - User content (bill names, notes)
- **Data Not Collected:**
  - Location, browsing history, etc. (if applicable)
- **Usage:** App functionality only

#### Data Safety (Android)
Must declare in Play Console:
- Types of data collected
- How data is used
- Security practices (encryption in transit/at rest)

---

## 🚀 Build & Submit Process

### Step 1: Prepare for Production Build

```bash
cd apps/mobile

# Update version in app.json
# version: "1.0.0"
# iOS buildNumber: "1"
# Android versionCode will auto-increment with EAS

# Ensure all production API endpoints are configured
# Check src/api/client.ts for hardcoded dev URLs
```

### Step 2: Build for iOS (EAS)

```bash
# Login to EAS (if not already)
eas login

# Build for iOS
eas build --platform ios --profile production

# This creates an .ipa file
# Download when complete: eas build:list
```

### Step 3: Build for Android (EAS)

```bash
# Build for Android
eas build --platform android --profile production

# This creates an .aab (App Bundle)
```

### Step 4: Submit to Apple App Store

**Option A: Automatic (via EAS)**
```bash
# Fill in eas.json submit.production.ios first!
eas submit --platform ios --latest
```

**Option B: Manual (via Xcode/Transporter)**
1. Download .ipa from EAS
2. Use Apple Transporter app to upload
3. Configure in App Store Connect

### Step 5: Submit to Google Play Store

**Option A: Automatic (via EAS)**
```bash
eas submit --platform android --latest
```

**Option B: Manual**
1. Download .aab from EAS
2. Upload to Play Console → Production → Create new release
3. Roll out to production (or internal testing first)

---

## 🧪 Testing Before Submission

### Internal Testing
```bash
# Build preview/beta versions first
eas build --profile preview --platform all

# Distribute to testers via:
# - TestFlight (iOS) - auto-configured with EAS
# - Internal testing track (Android)
```

### Pre-Launch Checklist
- [ ] Test on physical devices (iOS and Android)
- [ ] Test all authentication flows (login, signup, 2FA, OAuth)
- [ ] Test offline/online sync
- [ ] Test push notifications
- [ ] Verify no dev/staging API endpoints
- [ ] Test in-app purchases (if applicable)
- [ ] Test deep linking (if applicable)
- [ ] Run on slow network conditions
- [ ] Check for memory leaks
- [ ] Verify all icons and images load correctly

---

## 📞 Support & Contact

**Support Email:** support@billmanager.app (or your email)  
**Support URL:** https://docs.billmanager.app/support (or your support page)

Both stores require a support URL and email.

---

## 🎯 Post-Submission

### Review Timeline
- **Apple:** 1-3 days typically (can be up to 7)
- **Google:** 1-7 days (faster after first approval)

### After Approval
- [ ] Monitor crash reports (Expo Crash Reporting / Sentry)
- [ ] Watch user reviews and respond
- [ ] Plan update schedule
- [ ] Set up app analytics (if not already)

### Common Rejection Reasons
**Apple:**
- Incomplete privacy policy
- Crashes on reviewer's device
- Missing features described in screenshots
- Design guideline violations

**Google:**
- Privacy policy issues
- Permissions not justified
- Crashes or bugs
- Misleading screenshots/descriptions

---

## 🔗 Resources

- [Expo Submission Guide](https://docs.expo.dev/submit/introduction/)
- [Apple App Store Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Google Play Policy Center](https://play.google.com/console/about/guides/)
- [App Store Connect](https://appstoreconnect.apple.com/)
- [Google Play Console](https://play.google.com/console/)

---

**Last Updated:** 2026-02-12  
**Status:** Ready for submission prep
