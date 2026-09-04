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
  retry: 'Try again',
  err_load: 'Could not load that. Check your connection and try again.',
  err_membership_load: 'Could not reach the server to check your account. This is a connection problem, not a permissions one.',

  /* dashboard */
  kpi_cash: 'Cash in hand',
  kpi_income_month: 'Income this month',
  kpi_spend_month: 'Spending this month',
  kpi_with_driver: 'With the driver',
  kpi_with_driver_note: 'Recorded but not yet handed over',
  kpi_allowance: 'Your monthly allowance',
  kpi_spent_month: 'You spent this month',
  kpi_pending: 'Waiting for approval',
  kpi_days_month: 'Days recorded this month',
  kpi_net_month: 'Net this month',
  kpi_your_share: 'Your share this month',
  kpi_not_handed: 'Not handed over yet',
  recent_activity: 'Recent activity',
  your_submissions: 'Your submissions',
  your_days: 'Your recorded days',
  nothing_yet: 'Nothing recorded yet.',
  see_all: 'See all',
  this_month: 'This month',
  net_negative_note: 'A losing day is shown as a loss. Costs come off before any share.',

  /* add */
  add_income: 'Income',
  add_expense: 'Expense',
  add_sub_admin: 'This posts straight into the family ledger.',
  add_sub_member: 'This is recorded against your allowance and waits for Abdo to approve it.',
  f_amount: 'Amount',
  f_amount_unit: 'EGP',
  f_category: 'Category',
  f_date: 'Date',
  f_person: 'On behalf of',
  f_person_none: 'Nobody in particular',
  f_memo: 'Note',
  f_desc: 'What was it for?',
  f_optional: 'optional',
  save: 'Record it',
  submit: 'Send for approval',
  saving: 'Saving…',
  saved: 'Recorded.',
  submitted: 'Sent to Abdo for approval.',
  add_another: 'Add another',
  err_amount: 'Enter an amount greater than zero',
  err_category: 'Pick a category',
  err_future: 'That day has not happened yet',
  err_recipient: 'This category records who received it',
  no_categories: 'No categories of that kind yet. Abdo adds them in Settings.',

  /* allowance */
  al_sub_admin: 'Pay each person their month, and change what they get from a date forward.',
  al_sub_viewer: 'What each person is paid, and what is left of it.',
  al_monthly: 'a month',
  al_paid: 'Paid',
  al_unpaid: 'Not paid',
  al_pay: 'Pay',
  al_confirm: 'Pay',
  al_cancel: 'Cancel',
  al_received: 'Received',
  al_change_rate: 'Change',
  al_new_rate: 'New monthly amount',
  al_from: 'From',
  al_rate_note: 'Applies from that date onwards. Months already paid keep the amount they were paid.',
  al_no_rate: 'No allowance set',
  al_nobody: 'Nobody has an allowance yet.',

  /* my spending */
  ms_balance: 'What is left',
  ms_received: 'Received so far',
  ms_approved: 'Approved spending',
  ms_waiting: 'Waiting on Abdo',
  ms_overspent: 'You have spent more than you were given. Talk to Abdo before the next one.',

  /* approvals */
  ap_sub: 'Each of these moves a balance the moment you decide it. Nothing moves until then.',
  ap_empty: 'Nothing waiting.',
  ap_approve: 'Approve',
  ap_reject: 'Reject',
  ap_confirm_reject: 'Reject it',
  ap_reason: 'Why?',
  ap_reason_note: 'They will see this. A rejection with no reason is how a ledger becomes an argument.',

  /* history */
  h_source: 'Source',
  h_person: 'Person',
  h_from: 'From',
  h_to: 'To',
  h_all: 'All',
  src_ledger: 'Family ledger',
  src_submission: 'Submissions',
  src_car: 'Car days',
  h_empty: 'Nothing matches those filters.',
  h_only_yours: 'You see your own submissions here. The family ledger is Abdo\'s and Ghada\'s.',
  load_more: 'Load more',
  reversal: 'Reversal',
  day_off: 'Day off',
  st_pending: 'Pending',
  st_approved: 'Approved',
  st_rejected: 'Rejected',
  st_recorded: 'Recorded',
  st_settled: 'Settled',
  st_off: 'Day off',
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
  retry: 'حاول تاني',
  err_load: 'مش قادر أحمّل البيانات. اتأكد من الاتصال وحاول تاني.',
  err_membership_load: 'مش قادر أوصل للسيرفر عشان أتأكد من حسابك. دي مشكلة اتصال، مش مشكلة صلاحيات.',

  kpi_cash: 'الكاش الموجود',
  kpi_income_month: 'دخل الشهر',
  kpi_spend_month: 'مصروف الشهر',
  kpi_with_driver: 'مع السائق',
  kpi_with_driver_note: 'اتسجّل بس لسه ماتسلّمش',
  kpi_allowance: 'مصروفك الشهري',
  kpi_spent_month: 'اللي صرفته الشهر ده',
  kpi_pending: 'مستني الموافقة',
  kpi_days_month: 'أيام متسجلة الشهر ده',
  kpi_net_month: 'الصافي الشهر ده',
  kpi_your_share: 'نصيبك الشهر ده',
  kpi_not_handed: 'لسه ماتسلّمش',
  recent_activity: 'آخر الحركات',
  your_submissions: 'طلباتك',
  your_days: 'أيامك المسجلة',
  nothing_yet: 'مافيش حاجة متسجلة لسه.',
  see_all: 'شوف الكل',
  this_month: 'الشهر ده',
  net_negative_note: 'اليوم الخسران بيتسجل خسارة. المصاريف بتتخصم قبل أي نصيب.',

  add_income: 'دخل',
  add_expense: 'مصروف',
  add_sub_admin: 'دي بتتسجل على طول في دفتر العائلة.',
  add_sub_member: 'دي بتتسجل على مصروفك وبتستنى عبده يوافق عليها.',
  f_amount: 'المبلغ',
  f_amount_unit: 'جنيه',
  f_category: 'البند',
  f_date: 'التاريخ',
  f_person: 'بالنيابة عن',
  f_person_none: 'مش محدد',
  f_memo: 'ملاحظة',
  f_desc: 'كانت على إيه؟',
  f_optional: 'اختياري',
  save: 'سجّلها',
  submit: 'ابعتها للموافقة',
  saving: 'بيتسجل…',
  saved: 'اتسجلت.',
  submitted: 'اتبعتت لعبده عشان يوافق.',
  add_another: 'ضيف واحدة تانية',
  err_amount: 'اكتب مبلغ أكبر من صفر',
  err_category: 'اختار بند',
  err_future: 'اليوم ده لسه ماجاش',
  err_recipient: 'البند ده لازم يتسجل معاه المستفيد',
  no_categories: 'مافيش بنود من النوع ده لسه. عبده بيضيفها من الإعدادات.',

  al_sub_admin: 'اصرف لكل واحد شهره، وغيّر اللي بياخده من تاريخ ورايح.',
  al_sub_viewer: 'كل واحد بياخد كام، وفاضل معاه كام.',
  al_monthly: 'في الشهر',
  al_paid: 'اتصرف',
  al_unpaid: 'لسه ماتصرفش',
  al_pay: 'اصرف',
  al_confirm: 'اصرف',
  al_cancel: 'إلغاء',
  al_received: 'استلم',
  al_change_rate: 'تغيير',
  al_new_rate: 'المبلغ الشهري الجديد',
  al_from: 'من تاريخ',
  al_rate_note: 'بيسري من التاريخ ده ورايح. الشهور اللي اتصرفت بتفضل بمبلغها الأصلي.',
  al_no_rate: 'مافيش مصروف متحدد',
  al_nobody: 'مافيش حد ليه مصروف لسه.',

  ms_balance: 'الفاضل',
  ms_received: 'اللي استلمته',
  ms_approved: 'المصروف المعتمد',
  ms_waiting: 'مستني عبده',
  ms_overspent: 'صرفت أكتر من اللي اتصرفلك. كلّم عبده قبل المرة الجاية.',

  ap_sub: 'كل واحدة فيهم بتحرّك رصيد العضو أول ما تقرر فيها. قبل كده مافيش حاجة بتتحرك.',
  ap_empty: 'مافيش حاجة مستنية.',
  ap_approve: 'موافقة',
  ap_reject: 'رفض',
  ap_confirm_reject: 'ارفضها',
  ap_reason: 'ليه؟',
  ap_reason_note: 'هيشوف السبب ده. الرفض من غير سبب هو اللي بيحوّل الدفتر لخناقة.',

  h_source: 'المصدر',
  h_person: 'الشخص',
  h_from: 'من',
  h_to: 'إلى',
  h_all: 'الكل',
  src_ledger: 'دفتر العائلة',
  src_submission: 'الطلبات',
  src_car: 'أيام السيارة',
  h_empty: 'مافيش حاجة مطابقة للفلاتر دي.',
  h_only_yours: 'هنا بتشوف طلباتك إنت بس. دفتر العائلة بتاع عبده وغادة.',
  load_more: 'عرض المزيد',
  reversal: 'عكس قيد',
  day_off: 'يوم راحة',
  st_pending: 'مستني',
  st_approved: 'اتوافق عليها',
  st_rejected: 'اترفضت',
  st_recorded: 'متسجل',
  st_settled: 'اتسلّم',
  st_off: 'يوم راحة',
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
