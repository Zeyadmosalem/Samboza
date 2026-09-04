/* Bilingual string table. Arabic flips the whole document to RTL.
   Numbers stay in Western digits — that is what Egyptian bank and
   receipt copy uses, and it keeps the charts readable in both modes. */
window.I18N = (function () {
  'use strict';

  const en = {
    app_name:'Samboza Family Finance', family:'Samboza Family', tagline:'One private ledger for the whole family',
    demo_badge:'Demo', demo_note:'Sample data — nothing is saved',

    /* auth */
    auth_title:'Who are you signing in as?',
    auth_sub:'Pick a person to see the app through their eyes. Each role sees a different app.',
    auth_hint:'This is a demo — no password needed.',
    sign_in:'Sign in', switch_user:'Switch user', sign_out:'Sign out',

    /* nav + screens */
    nav_dashboard:'Dashboard', nav_add:'Add Transaction', nav_remittance:'Remittance',
    nav_allowance:'Allowance', nav_myspending:'My Spending', nav_car:'Car', nav_loans:'Loans',
    nav_history:'History', nav_reports:'Reports', nav_people:'People', nav_settings:'Settings',
    nav_group_money:'Money', nav_group_family:'Family', nav_group_admin:'Admin',

    /* roles */
    role_admin:'Admin', role_member:'Member', role_viewer:'Viewer',
    role_admin_note:'Records and edits everything',
    role_member_note:'Logs their own spending against allowance',
    role_viewer_note:'Read-only. Sees everything, changes nothing',
    readonly_banner:'Read-only view — you can see everything, but nothing can be changed from this account.',

    /* people */
    p_mother:'Ghada', p_abdo:'Abdo', p_zeyad:'Zeyad', p_rewan:'Rewan',
    p_mona:'Mona', p_grandma:'Grandma', p_marwa:'Marwa', p_uncle:'Joe',
    p_adamanas:'Adam & Anas',
    r_mother:'Mother', r_brother:'Big brother', r_son:'Son', r_daughter:'Daughter',
    r_aunt:'Aunt', r_grandmother:'Grandmother', r_uncle_maternal:'Uncle (mother’s side)', r_cousins:'Cousins',

    /* categories */
    c_allowance:'Allowance', c_rent:'Rent', c_food:'Food', c_education:'Education',
    c_medical:'Medical', c_gifts:'Gifts', c_car:'Car', c_loanrepay:'Loan repayment',
    c_other:'Other', c_remittance:'Remittance', c_carprofit:'Car profit', c_loanin:'Loan received',

    /* dashboard */
    cash_on_hand:'Cash on hand', since_remittance:'Days since last remittance',
    period_income:'Income · last 30 days', period_expense:'Spent · last 30 days',
    net_period:'Net · last 30 days', recent_activity:'Recent activity', view_all:'View all',
    days:'days', last_arrived:'Last arrived', no_activity:'Nothing logged yet',
    my_balance:'My allowance balance', my_received:'Received to date', my_spent:'Logged to date',
    kpi_hint_cash:'Total income minus total expenses, all time',

    /* add transaction */
    add_title:'Add a transaction', income:'Income', expense:'Expense',
    amount:'Amount', currency:'Currency', category:'Category', date:'Date',
    on_behalf:'On behalf of', note:'Note', note_ph:'What was this for?',
    nobody:'— nobody in particular —', save_tx:'Save transaction',
    saved:'Saved', rate_line:'Rate {r} · lands as {v}',
    err_amount:'Enter an amount greater than zero', err_cat:'Pick a category',
    member_add_note:'Anything you log here comes off your allowance balance.',

    /* remittance */
    rem_title:'Remittances from Mother', rem_sub:'Lump sums handed over on a visit. The rate used is stored with the record, so history stays auditable.',
    rem_log:'Log a remittance', received_on:'Received on', visit:'Visit', rate:'Rate used',
    original:'Original', in_egp:'In EGP', rem_total:'Received in the last 6 months',

    /* allowance */
    allow_title:'Allowance', allow_sub:'Monthly disbursements. Zeyad and Rewan log their own spending against what they receive; the others just receive.',
    recipient:'Recipient', monthly:'Monthly', this_month:'This month', paid:'Paid', mark_paid:'Mark paid',
    pay_all:'Pay everyone for this month', balance:'Balance', logs_spending:'Logs spending',
    receives_only:'Receives only', total_monthly:'Total per month', all_paid:'Everyone is paid for this month',

    /* my spending */
    my_title:'My spending', my_sub:'What you have logged against your allowance.',
    log_expense:'Log an expense', my_history:'My history', habits:'Where my money goes',
    of_allowance:'of this month’s allowance',

    /* car */
    car_title:'The Uber car', car_sub:'Joe drives and submits each day himself. Every expense he records comes off that day’s takings first; he then takes a third of what is left, and the remainder splits 75% to the family and 25% to Marwa.',
    gross:'Gross income', uncle_share:'Joe’s share (⅓)', operating_pool:'Remaining (⅔)',
    car_expenses:'Car expenses', profit:'Profit', family_share:'Family share (75%)', marwa_share:'Marwa’s share (25%)',
    settle:'Settle this period', settled:'Settled', open_period:'Open', add_car_expense:'Add car expense',
    fuel:'Fuel', maintenance:'Maintenance', licensing:'Licensing', car_history:'Past settlements',
    period:'Period', status:'Status', car_calc:'Settled daily. Joe submits the takings and costs; the app does the arithmetic.',

    /* loans */
    loan_title:'Loans', loan_sub:'Kept apart from ordinary income so the family can see what it still owes.',
    lender:'Lender', borrowed:'Borrowed', lent:'Lent out', outstanding:'Outstanding',
    partial:'Partly repaid', repaid:'Repaid', repayments:'Repayments', add_repayment:'Add repayment',
    remaining:'Remaining', taken_on:'Taken on', add_loan:'Register a loan', no_loans:'No loans on the books',
    total_owed:'Still owed',

    /* history */
    hist_title:'History', search_ph:'Search notes, people, categories…',
    all:'All', filter_type:'Type', filter_cat:'Category', filter_person:'Person',
    today:'Today', yesterday:'Yesterday', results_none:'Nothing matches those filters',
    results_count:'{n} transactions', clear_filters:'Clear',

    /* reports */
    rep_title:'Reports', rep_inc_exp:'Income vs expenses', rep_inc_exp_sub:'Last six months, EGP',
    rep_cat:'Where the money goes', rep_cat_sub:'Expenses by category, last six months',
    rep_trend:'Cash trend', rep_trend_sub:'Running balance at each month end',
    rep_person:'Spending by person', rep_person_sub:'Expenses recorded on behalf of each person',
    total:'Total', table_view:'Table view', show_table:'Show as table', hide_table:'Hide table',

    /* people screen */
    ppl_title:'People', ppl_sub:'Everyone the money touches. Beneficiaries who cannot sign in today can be promoted to users later without rewriting history.',
    can_sign_in:'Can sign in', beneficiary:'Beneficiary only', invite_code:'Family invite code',
    invite_hint:'Share this with a new family member', add_person:'Add person', gets_allowance:'Gets allowance',
    family_identity:'Family identity', family_code:'Family code', member_code:'Member code', id_col:'ID',
    relationship:'Relationship', role:'Role', new_person_sub:'Beneficiaries can be added without a login and promoted later.',
    internal_id:'Internal ID (UUID)', invite_expires:'Expires {d}', rotate_invite:'Rotate',
    id_note:'Two layers. The UUID is the primary key — never shown to anyone, never reused, and it survives a rename. The short code is what people read out and type.',
    invite_note:'The invite code is separate from the family code on purpose: it grants access, so it has to be revocable without changing who the family is.',
    signing_into:'Signing in to',

    /* driver (Joe) */
    role_driver:'Driver', role_driver_note:'Submits the car’s takings and running costs',
    nav_carday:'Record a Day', nav_myearnings:'My Earnings', nav_approvals:'Approvals',
    day_gross:'Takings for the day', date_of_day:'Which day?',
    date_hint:'Pick the day you drove. Days off are simply not submitted — nothing is assumed about today.',
    submit_day:'Submit this day', day_saved:'Day submitted', recent_days:'Recent days',
    days_driven:'Days driven', earned_total:'Earned to date', earned_month:'Last 30 days',
    awaiting:'Awaiting settlement', no_days:'Nothing submitted yet',
    my_earnings_sub:'Every day you have submitted, and what it earned you.',
    carday_sub:'Enter the day’s takings and what it cost to earn them. The app works out your third.',

    /* car expense classification */
    direct:'Direct', indirect:'Indirect', expense_kind:'Type', add_expense_row:'Add expense',
    kind_note:'You choose direct or indirect on every line. Direct is what it cost to earn the fares — fuel, tolls. Indirect is administration, the kārta permit, a fine. Picking a label suggests a class, but you can change it. Both come off the takings before your third; the label is what the family reports on.',
    e_fuel:'Fuel', e_tolls:'Tolls', e_permit:'Permit (kārta)', e_admin:'Administration', e_ticket:'Traffic fine',
    e_other:'Other', exp_note_ph:'Note — what was it? (optional)', n_carwash:'Car wash',
    net_after:'Net after expenses', joe_share:'Joe’s share (⅓)', remaining_after:'Remaining after Joe’s share',
    total_direct:'Direct expenses', total_indirect:'Indirect expenses',

    /* approvals */
    approvals_sub:'Everything Zeyad and Rewan submit waits here. It does not move their balance until you approve it.',
    pending:'Pending', approved:'Approved', rejected:'Rejected', approve:'Approve', reject:'Reject',
    nothing_pending:'Nothing waiting for you', submitted_by:'Submitted by', pending_count:'{n} waiting',
    member_pending_note:'Waiting for Abdo to approve. It will not change your balance until he does.',
    pending_total:'Pending', decided:'Decided',

    /* allowance rates */
    allow_rate_note:'A fixed monthly amount per person that can be raised or lowered. A change is dated, so it never rewrites what was already paid.',
    rate_since:'Since {d}',

    /* settings */
    set_title:'Settings', set_cats:'Categories', set_cats_sub:'Abdo can add to the default set.',
    set_fx:'Exchange rates', set_fx_sub:'Entered per remittance and stored with the record.',
    set_lang:'Language', theme_toggle:'Switch between light and dark', set_export:'Export', set_export_sub:'CSV and Excel land in Phase 2.',
    set_open:'Decisions',
    set_open_sub:'Settled with the family on 4 September 2026. Each one is built into this demo.',

    /* open questions (§10) */
    q1:'Car settlement period',
    q2:'When Joe’s third is taken',
    q3:'Allowance cadence',
    q4:'FX rate source',
    q5:'Approval for member submissions',
    q6:'What members can see',
    q7:'Gifts',
    q8:'Cash vs bank',
    q9:'Calendar and language',
    a1:'Daily. Joe picks the date himself — there are days off.',
    a2:'After expenses. He classifies each one direct or indirect as he enters it.',
    a3:'Fixed monthly per person, and it can be raised or lowered over time.',
    a4:'Abdo types it himself, stored with the record.',
    a5:'Yes — nothing moves a balance until Abdo approves it.',
    a6:'Strictly their own numbers, never family totals.',
    a7:'Record the recipient, with an optional note.',
    a8:'One pot. No account separation.',
    a9:'Gregorian only. English and Arabic from day one.',

    /* misc */
    egp:'EGP', person:'Person', amount_egp:'Amount (EGP)', actions:'Actions',
    add:'Add', cancel:'Cancel', close:'Close', of:'of', none:'None',
    m1:'January', m2:'February', m3:'March', m4:'April', m5:'May', m6:'June',
    m7:'July', m8:'August', m9:'September', m10:'October', m11:'November', m12:'December',
    ms1:'Jan', ms2:'Feb', ms3:'Mar', ms4:'Apr', ms5:'May', ms6:'Jun',
    ms7:'Jul', ms8:'Aug', ms9:'Sep', ms10:'Oct', ms11:'Nov', ms12:'Dec',

    /* transaction notes */
    n_rent:'Monthly rent', n_grocery_big:'Big grocery run', n_grocery:'Groceries',
    n_allowance:'Monthly allowance', n_school_term:'School term fees', n_uni_fees:'University fees',
    n_prescription:'Pharmacy — prescription', n_clinic:'Clinic visit', n_dentist:'Dentist',
    n_eid_gifts:'Eid gifts', n_wedding_gift:'Wedding gift', n_utilities:'Utilities and internet',
    n_taxi:'Taxi', n_visit_spring:'Spring visit', n_visit_eid:'Eid visit', n_visit_summer:'Summer visit',
    n_car_share:'Car profit share', n_loan_note:'Borrowed for university fees',
    n_loan_in:'Loan received', n_loan_out:'Loan repayment', n_canteen:'School canteen',
    n_transport:'Transport', n_eating_out:'Eating out', n_books:'Books',
    n_stationery:'Stationery', n_gift_friend:'Gift for a friend', n_pharmacy:'Pharmacy',
    n_other_note:'No note', n_visit_new:'New remittance', household:'Household'
  };

  const ar = {
    app_name:'سمبوزة — مالية العائلة', family:'عائلة سمبوزة', tagline:'دفتر واحد خاص بالعائلة كلها',
    demo_badge:'عرض تجريبي', demo_note:'بيانات تجريبية — لا يتم حفظ أي شيء',

    auth_title:'بتدخل باسم مين؟',
    auth_sub:'اختر شخصًا لترى التطبيق بعينيه. كل صلاحية ترى تطبيقًا مختلفًا.',
    auth_hint:'هذا عرض تجريبي — لا حاجة لكلمة مرور.',
    sign_in:'تسجيل الدخول', switch_user:'تغيير المستخدم', sign_out:'تسجيل الخروج',

    nav_dashboard:'لوحة المتابعة', nav_add:'إضافة حركة', nav_remittance:'الحوالات',
    nav_allowance:'المصروف', nav_myspending:'مصروفاتي', nav_car:'السيارة', nav_loans:'السلف',
    nav_history:'السجل', nav_reports:'التقارير', nav_people:'الأفراد', nav_settings:'الإعدادات',
    nav_group_money:'الفلوس', nav_group_family:'العائلة', nav_group_admin:'الإدارة',

    role_admin:'مدير', role_member:'عضو', role_viewer:'مراجِع',
    role_admin_note:'يسجل ويعدّل كل شيء',
    role_member_note:'يسجل مصروفاته من مصروفه الشخصي',
    role_viewer_note:'اطلاع فقط. يرى كل شيء ولا يغيّر شيئًا',
    readonly_banner:'عرض للاطلاع فقط — ترى كل شيء، لكن لا يمكن تعديل أي شيء من هذا الحساب.',

    p_mother:'غادة', p_abdo:'عبدو', p_zeyad:'زياد', p_rewan:'ريوان',
    p_mona:'منى', p_grandma:'الجدة', p_marwa:'مروة', p_uncle:'يوسف',
    p_adamanas:'آدم وأنس',
    r_mother:'الوالدة', r_brother:'الأخ الأكبر', r_son:'الابن', r_daughter:'الابنة',
    r_aunt:'الخالة', r_grandmother:'الجدة', r_uncle_maternal:'الخال', r_cousins:'أولاد الخالة',

    c_allowance:'المصروف', c_rent:'الإيجار', c_food:'الأكل', c_education:'التعليم',
    c_medical:'العلاج', c_gifts:'الهدايا', c_car:'السيارة', c_loanrepay:'سداد سلفة',
    c_other:'أخرى', c_remittance:'حوالة', c_carprofit:'أرباح السيارة', c_loanin:'سلفة مستلمة',

    cash_on_hand:'المتاح حاليًا', since_remittance:'يوم من آخر حوالة',
    period_income:'الوارد · آخر ٣٠ يوم', period_expense:'المنصرف · آخر ٣٠ يوم',
    net_period:'الصافي · آخر ٣٠ يوم', recent_activity:'آخر الحركات', view_all:'عرض الكل',
    days:'يوم', last_arrived:'آخر وصول', no_activity:'لا توجد حركات بعد',
    my_balance:'رصيد مصروفي', my_received:'المستلم حتى الآن', my_spent:'المسجَّل حتى الآن',
    kpi_hint_cash:'إجمالي الوارد ناقص إجمالي المنصرف، منذ البداية',

    add_title:'إضافة حركة', income:'وارد', expense:'منصرف',
    amount:'المبلغ', currency:'العملة', category:'التصنيف', date:'التاريخ',
    on_behalf:'بالنيابة عن', note:'ملاحظة', note_ph:'الحركة دي كانت على إيه؟',
    nobody:'— لا أحد بعينه —', save_tx:'حفظ الحركة',
    saved:'تم الحفظ', rate_line:'بسعر {r} · يعادل {v}',
    err_amount:'أدخل مبلغًا أكبر من صفر', err_cat:'اختر تصنيفًا',
    member_add_note:'أي حركة تسجلها هنا تُخصم من رصيد مصروفك.',

    rem_title:'حوالات الوالدة', rem_sub:'مبالغ كبيرة تُسلَّم أثناء الزيارة. السعر المستخدم يُحفظ مع السجل، فيبقى التاريخ قابلًا للمراجعة.',
    rem_log:'تسجيل حوالة', received_on:'تاريخ الاستلام', visit:'الزيارة', rate:'السعر المستخدم',
    original:'المبلغ الأصلي', in_egp:'بالجنيه', rem_total:'المستلم خلال ٦ شهور',

    allow_title:'المصروف', allow_sub:'صرف شهري. زياد وروان يسجلان مصروفاتهما ممّا يستلمانه؛ الباقون يستلمون فقط.',
    recipient:'المستلم', monthly:'شهريًا', this_month:'هذا الشهر', paid:'مدفوع', mark_paid:'تحديد كمدفوع',
    pay_all:'صرف مصروف الشهر للجميع', balance:'الرصيد', logs_spending:'يسجل مصروفاته',
    receives_only:'يستلم فقط', total_monthly:'الإجمالي شهريًا', all_paid:'تم صرف مصروف الشهر للجميع',

    my_title:'مصروفاتي', my_sub:'ما سجّلته من مصروفك الشخصي.',
    log_expense:'تسجيل مصروف', my_history:'سجلي', habits:'فلوسي بتروح فين',
    of_allowance:'من مصروف الشهر',

    car_title:'سيارة أوبر', car_sub:'يوسف بيسوق وبيسجل كل يوم بنفسه. أي مصروف بيسجله بيتخصم من إيراد اليوم الأول؛ بعدين بياخد ثلث الباقي، واللي يفضل بينقسم ٧٥٪ للعائلة و٢٥٪ لمروة.',
    gross:'إجمالي الإيراد', uncle_share:'نصيب يوسف (⅓)', operating_pool:'الباقي (⅔)',
    car_expenses:'مصاريف السيارة', profit:'صافي الربح', family_share:'نصيب العائلة (٧٥٪)', marwa_share:'نصيب مروة (٢٥٪)',
    settle:'تسوية الفترة', settled:'تمت التسوية', open_period:'مفتوحة', add_car_expense:'إضافة مصروف سيارة',
    fuel:'بنزين', maintenance:'صيانة', licensing:'ترخيص', car_history:'التسويات السابقة',
    period:'الفترة', status:'الحالة', car_calc:'التسوية يومية. يوسف بيسجل الإيراد والمصاريف، والتطبيق بيعمل الحسبة.',

    loan_title:'السلف', loan_sub:'مفصولة عن الوارد العادي عشان العائلة تشوف المستحق عليها.',
    lender:'المُقرِض', borrowed:'مستلفة', lent:'مُقرَضة', outstanding:'قائمة',
    partial:'مسدَّدة جزئيًا', repaid:'مسدَّدة', repayments:'السداد', add_repayment:'إضافة سداد',
    remaining:'المتبقي', taken_on:'تاريخ السلفة', add_loan:'تسجيل سلفة', no_loans:'لا توجد سلف',
    total_owed:'المستحق علينا',

    hist_title:'السجل', search_ph:'ابحث في الملاحظات والأشخاص والتصنيفات…',
    all:'الكل', filter_type:'النوع', filter_cat:'التصنيف', filter_person:'الشخص',
    today:'اليوم', yesterday:'أمس', results_none:'لا توجد نتائج مطابقة',
    results_count:'{n} حركة', clear_filters:'مسح',

    rep_title:'التقارير', rep_inc_exp:'الوارد مقابل المنصرف', rep_inc_exp_sub:'آخر ٦ شهور، بالجنيه',
    rep_cat:'الفلوس بتروح فين', rep_cat_sub:'المنصرف حسب التصنيف، آخر ٦ شهور',
    rep_trend:'اتجاه الرصيد', rep_trend_sub:'الرصيد التراكمي في نهاية كل شهر',
    rep_person:'المنصرف حسب الشخص', rep_person_sub:'المصروفات المسجلة بالنيابة عن كل شخص',
    total:'الإجمالي', table_view:'عرض جدولي', show_table:'اعرض كجدول', hide_table:'إخفاء الجدول',

    ppl_title:'الأفراد', ppl_sub:'كل من تمسّه الفلوس. المستفيد الذي لا يسجّل دخولًا اليوم يمكن ترقيته لمستخدم لاحقًا دون إعادة كتابة التاريخ.',
    can_sign_in:'يسجل الدخول', beneficiary:'مستفيد فقط', invite_code:'كود دعوة العائلة',
    invite_hint:'شارك الكود مع فرد جديد من العائلة', add_person:'إضافة شخص', gets_allowance:'يستلم مصروف',
    family_identity:'هوية العائلة', family_code:'كود العائلة', member_code:'كود الفرد', id_col:'المعرّف',
    relationship:'صلة القرابة', role:'الصلاحية', new_person_sub:'يمكن إضافة مستفيد بدون حساب وترقيته لاحقًا.',
    internal_id:'المعرّف الداخلي (UUID)', invite_expires:'ينتهي في {d}', rotate_invite:'تغيير',
    id_note:'طبقتان. الـ UUID هو المفتاح الأساسي — لا يظهر لأحد ولا يُعاد استخدامه ويبقى كما هو حتى لو تغيّر الاسم. الكود القصير هو اللي الناس تقوله وتكتبه.',
    invite_note:'كود الدعوة منفصل عن كود العائلة عن قصد: هو بيمنح صلاحية دخول، فلازم نقدر نلغيه من غير ما نغيّر هوية العائلة.',
    signing_into:'تسجيل الدخول إلى',

    /* driver (Joe) */
    role_driver:'السائق', role_driver_note:'يسجل إيراد السيارة ومصاريفها',
    nav_carday:'تسجيل يوم', nav_myearnings:'أرباحي', nav_approvals:'الموافقات',
    day_gross:'إيراد اليوم', date_of_day:'أي يوم؟',
    date_hint:'اختر اليوم اللي اشتغلت فيه. أيام الراحة ببساطة مش بتتسجل — التطبيق مش بيفترض إن النهاردة يوم شغل.',
    submit_day:'تسجيل اليوم', day_saved:'تم تسجيل اليوم', recent_days:'الأيام الأخيرة',
    days_driven:'أيام العمل', earned_total:'المكتسب حتى الآن', earned_month:'آخر ٣٠ يوم',
    awaiting:'في انتظار التسوية', no_days:'لا يوجد تسجيل بعد',
    my_earnings_sub:'كل يوم سجّلته، وكام كسبت منه.',
    carday_sub:'دخّل إيراد اليوم واللي دفعته عشان تكسبه. التطبيق بيحسب نصيبك.',

    /* car expense classification */
    direct:'مباشرة', indirect:'غير مباشرة', expense_kind:'النوع', add_expense_row:'إضافة مصروف',
    kind_note:'انت اللي بتختار مباشرة ولا غير مباشرة في كل سطر. المباشرة هي اللي دفعتها عشان تكسب اليوم — بنزين ورسوم طرق. غير المباشرة مصاريف إدارية أو الكارتة أو مخالفة. لما تختار نوع المصروف بنقترح عليك تصنيف، وتقدر تغيره. الاتنين بيتخصموا من الإيراد قبل نصيبك.',
    e_fuel:'بنزين', e_tolls:'رسوم طرق', e_permit:'كارتة', e_admin:'مصاريف إدارية', e_ticket:'مخالفة',
    e_other:'أخرى', exp_note_ph:'ملاحظة — كانت إيه؟ (اختياري)', n_carwash:'غسيل العربية',
    net_after:'الصافي بعد المصاريف', joe_share:'نصيب يوسف (⅓)', remaining_after:'الباقي بعد نصيب يوسف',
    total_direct:'مصاريف مباشرة', total_indirect:'مصاريف غير مباشرة',

    /* approvals */
    approvals_sub:'كل اللي زياد وروان بيسجلوه بيستنى هنا. مش بيأثر على رصيدهم غير لما توافق.',
    pending:'في الانتظار', approved:'تمت الموافقة', rejected:'مرفوض', approve:'موافقة', reject:'رفض',
    nothing_pending:'مفيش حاجة مستنية منك', submitted_by:'مقدَّم من', pending_count:'{n} في الانتظار',
    member_pending_note:'في انتظار موافقة عبده. مش هيتغير رصيدك غير لما يوافق.',
    pending_total:'في الانتظار', decided:'تم البت فيها',

    /* allowance rates */
    allow_rate_note:'مبلغ شهري ثابت لكل شخص، يقدر يزيد أو يقل. أي تغيير بيتسجل بتاريخه، فمش بيغيّر اللي اتصرف قبل كده.',
    rate_since:'من {d}',

    /* settings */
    set_title:'الإعدادات', set_cats:'التصنيفات', set_cats_sub:'عبده يقدر يضيف على المجموعة الافتراضية.',
    set_fx:'أسعار الصرف', set_fx_sub:'تُدخل مع كل حوالة وتُحفظ مع السجل.',
    set_lang:'اللغة', theme_toggle:'تبديل بين الفاتح والداكن', set_export:'التصدير', set_export_sub:'CSV و Excel في المرحلة الثانية.',
    set_open:'القرارات',
    set_open_sub:'اتحسمت مع العيلة يوم ٤ سبتمبر ٢٠٢٦. وكل قرار منهم متطبق في العرض ده.',

    q1:'دورية تسوية السيارة',
    q2:'إمتى بياخد الخال نصيبه',
    q3:'نظام المصروف',
    q4:'مصدر سعر الصرف',
    q5:'الموافقة على تسجيلات الأعضاء',
    q6:'اللي الأعضاء يشوفوه',
    q7:'الهدايا',
    q8:'الكاش والبنك',
    q9:'التقويم واللغة',
    a1:'يومية. يوسف بيختار التاريخ بنفسه — في أيام راحة.',
    a2:'بعد المصاريف. وبيصنّف كل مصروف مباشر ولا غير مباشر وهو بيسجله.',
    a3:'مبلغ شهري ثابت لكل شخص، ويقدر يزيد أو يقل مع الوقت.',
    a4:'عبده بيكتبه بنفسه، ويتحفظ مع السجل.',
    a5:'نعم — مفيش حاجة بتأثر على الرصيد غير لما عبده يوافق.',
    a6:'أرقامهم هم بس، ومش بيشوفوا إجمالي العائلة.',
    a7:'نسجل المستلم، مع ملاحظة اختيارية.',
    a8:'وعاء واحد. من غير فصل حسابات.',
    a9:'ميلادي بس. إنجليزي وعربي من أول يوم.',

    egp:'ج.م', person:'الشخص', amount_egp:'المبلغ (ج.م)', actions:'إجراءات',
    add:'إضافة', cancel:'إلغاء', close:'إغلاق', of:'من', none:'لا شيء',
    m1:'يناير', m2:'فبراير', m3:'مارس', m4:'أبريل', m5:'مايو', m6:'يونيو',
    m7:'يوليو', m8:'أغسطس', m9:'سبتمبر', m10:'أكتوبر', m11:'نوفمبر', m12:'ديسمبر',
    ms1:'ينا', ms2:'فبر', ms3:'مار', ms4:'أبر', ms5:'ماي', ms6:'يون',
    ms7:'يول', ms8:'أغس', ms9:'سبت', ms10:'أكت', ms11:'نوف', ms12:'ديس',

    n_rent:'إيجار الشهر', n_grocery_big:'تسوق البقالة الكبير', n_grocery:'بقالة',
    n_allowance:'مصروف الشهر', n_school_term:'مصروفات الترم', n_uni_fees:'مصروفات الجامعة',
    n_prescription:'صيدلية — روشتة', n_clinic:'كشف عيادة', n_dentist:'طبيب أسنان',
    n_eid_gifts:'هدايا العيد', n_wedding_gift:'هدية زواج', n_utilities:'مرافق وإنترنت',
    n_taxi:'تاكسي', n_visit_spring:'زيارة الربيع', n_visit_eid:'زيارة العيد', n_visit_summer:'زيارة الصيف',
    n_car_share:'نصيب أرباح السيارة', n_loan_note:'سلفة لمصروفات الجامعة',
    n_loan_in:'سلفة مستلمة', n_loan_out:'سداد سلفة', n_canteen:'كافيتيريا المدرسة',
    n_transport:'مواصلات', n_eating_out:'أكل بره', n_books:'كتب',
    n_stationery:'أدوات مكتبية', n_gift_friend:'هدية لصديقة', n_pharmacy:'صيدلية',
    n_other_note:'بدون ملاحظة', n_visit_new:'حوالة جديدة', household:'مصروف البيت'
  };

  const dict = { en, ar };
  let lang = 'en';

  const nf = { en: new Intl.NumberFormat('en-US'), ar: new Intl.NumberFormat('ar-EG-u-nu-latn') };

  function t(key, vars) {
    let s = dict[lang][key];
    if (s == null) s = dict.en[key];
    if (s == null) return key;
    if (vars) Object.keys(vars).forEach(function (k) { s = s.split('{' + k + '}').join(vars[k]); });
    return s;
  }

  return {
    get lang() { return lang; },
    set: function (l) { lang = dict[l] ? l : 'en'; return lang; },
    isRTL: function () { return lang === 'ar'; },
    t: t,
    /** 12345 -> "12,345" */
    n: function (v) { return nf[lang].format(Math.round(v)); },
    /** 12345 -> "EGP 12,345" / "12,345 ج.م" */
    money: function (v, opts) {
      const abs = nf[lang].format(Math.abs(Math.round(v)));
      const sign = (opts && opts.signed && v !== 0) ? (v > 0 ? '+' : '−') : (v < 0 ? '−' : '');
      const unit = (opts && opts.currency) || t('egp');
      return lang === 'ar' ? sign + abs + ' ' + unit : sign + unit + ' ' + abs;
    },
    /** short "14 Jun" / long "14 June 2026" */
    date: function (dt, long) {
      const m = t((long ? 'm' : 'ms') + (dt.getMonth() + 1));
      return long ? dt.getDate() + ' ' + m + ' ' + dt.getFullYear() : dt.getDate() + ' ' + m;
    },
    monthLabel: function (mi, long) { return t((long ? 'm' : 'ms') + mi); }
  };
})();
