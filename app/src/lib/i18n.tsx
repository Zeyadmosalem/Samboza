import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

/**
 * English and Arabic from day one (decision D9), with a full RTL layout.
 * Numbers stay in Western digits in both — that is what Egyptian bank and
 * receipt copy uses, and it keeps figures readable in the charts.
 */

type Lang = 'en' | 'ar'

const en = {
  app_name: 'Samboza Family Finance',
  family: 'Samboza Family',
  tagline: 'One private ledger for the whole family',

  /* auth */
  signing_into: 'Signing in to',
  login_title: 'Sign in',
  login_sub: 'Your own account. What you can see and do depends on who you are.',
  email: 'Email',
  password: 'Password',
  sign_in: 'Sign in',
  signing_in: 'Signing in…',
  sign_out: 'Sign out',
  forgot: 'Forgotten your password?',
  forgot_note: 'Abdo can send you a reset link — he can never see or set your password.',
  err_bad_credentials: 'That email and password do not match',
  err_no_membership: 'This account is not attached to a family. Ask Abdo to add you.',
  session_note: 'You stay signed in for a week, on each device.',

  /* roles */
  role_admin: 'Admin',
  role_member: 'Member',
  role_viewer: 'Viewer',
  role_driver: 'Driver',

  /* nav */
  nav_dashboard: 'Dashboard',
  nav_add: 'Add Transaction',
  nav_remittance: 'Remittance',
  nav_allowance: 'Allowance',
  nav_car: 'Car',
  nav_carday: 'Record a Day',
  nav_myearnings: 'My Earnings',
  nav_loans: 'Loans',
  nav_myspending: 'My Spending',
  nav_mymoney: 'My Money',
  nav_mymonth: 'My Month',
  nav_approvals: 'Approvals',
  nav_history: 'History',
  nav_reports: 'Reports',
  nav_people: 'People',
  nav_settings: 'Settings',
  nav_group_money: 'Money',
  nav_group_family: 'Family',
  nav_group_view: 'The family',
  nav_group_own: 'My money',
  nav_group_admin: 'Admin',

  /* shell */
  theme_toggle: 'Switch between light and dark',
  loading: 'Loading…',
  coming_in_phase_2: 'This screen arrives in Phase 2. The shell, the roles and the sign-in are what Phase 1 delivers.',
  switch_family: 'Switch family',
} as const

type Key = keyof typeof en

const ar: Record<Key, string> = {
  app_name: 'سمبوزة — مالية العائلة',
  family: 'عائلة سمبوزة',
  tagline: 'دفتر واحد خاص بالعائلة كلها',

  signing_into: 'تسجيل الدخول إلى',
  login_title: 'تسجيل الدخول',
  login_sub: 'حسابك أنت. اللي تشوفه وتعمله بيعتمد على مين انت.',
  email: 'البريد الإلكتروني',
  password: 'كلمة المرور',
  sign_in: 'تسجيل الدخول',
  signing_in: 'جاري الدخول…',
  sign_out: 'تسجيل الخروج',
  forgot: 'نسيت كلمة المرور؟',
  forgot_note: 'عبده يقدر يبعتلك رابط لإعادة التعيين — لكنه أبدًا مش بيشوف كلمة مرورك ولا بيحددها.',
  err_bad_credentials: 'البريد وكلمة المرور مش متطابقين',
  err_no_membership: 'الحساب ده مش مرتبط بعائلة. اطلب من عبده يضيفك.',
  session_note: 'هتفضل مسجل دخول لمدة أسبوع، على كل جهاز.',

  role_admin: 'مدير',
  role_member: 'عضو',
  role_viewer: 'مراجِع',
  role_driver: 'السائق',

  nav_dashboard: 'لوحة المتابعة',
  nav_add: 'إضافة حركة',
  nav_remittance: 'الحوالات',
  nav_allowance: 'المصروف',
  nav_car: 'السيارة',
  nav_carday: 'تسجيل يوم',
  nav_myearnings: 'أرباحي',
  nav_loans: 'السلف',
  nav_myspending: 'مصروفاتي',
  nav_mymoney: 'فلوسي',
  nav_mymonth: 'شهري',
  nav_approvals: 'الموافقات',
  nav_history: 'السجل',
  nav_reports: 'التقارير',
  nav_people: 'الأفراد',
  nav_settings: 'الإعدادات',
  nav_group_money: 'الفلوس',
  nav_group_family: 'العائلة',
  nav_group_view: 'العائلة',
  nav_group_own: 'فلوسي',
  nav_group_admin: 'الإدارة',

  theme_toggle: 'تبديل بين الفاتح والداكن',
  loading: 'جاري التحميل…',
  coming_in_phase_2: 'الشاشة دي هتيجي في المرحلة الثانية. المرحلة الأولى بتسلّم الهيكل والصلاحيات وتسجيل الدخول.',
  switch_family: 'تغيير العائلة',
}

const dicts = { en, ar } as const

interface I18n {
  lang: Lang
  rtl: boolean
  t: (key: Key) => string
  setLang: (l: Lang) => void
}

const Ctx = createContext<I18n | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(
    () => (localStorage.getItem('samboza-lang') === 'ar' ? 'ar' : 'en')
  )

  useEffect(() => {
    document.documentElement.lang = lang
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'
    localStorage.setItem('samboza-lang', lang)
  }, [lang])

  const value: I18n = {
    lang,
    rtl: lang === 'ar',
    t: (key) => dicts[lang][key] ?? en[key] ?? key,
    setLang: setLangState,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useT() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useT must be used inside <I18nProvider>')
  return v
}

/** 1234567 piastres → "EGP 12,346". Money is piastres everywhere. */
export function money(piastres: number, lang: Lang, currency = 'EGP') {
  const fmt = new Intl.NumberFormat(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US')
  const abs = fmt.format(Math.round(Math.abs(piastres) / 100))
  const sign = piastres < 0 ? '−' : ''
  return lang === 'ar' ? `${sign}${abs} ${currency}` : `${sign}${currency} ${abs}`
}
