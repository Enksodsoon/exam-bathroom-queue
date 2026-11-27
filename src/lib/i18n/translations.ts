export type Locale = "en" | "th";

export interface Translations {
  // Common
  appName: string;
  bathroomQueue: string;
  controller: string;
  staff: string;
  male: string;
  female: string;
  back: string;
  cancel: string;
  close: string;
  confirm: string;
  loading: string;
  liveSync: string;
  reconnecting: string;
  reconnectingShort: string;
  reconnectingNotice: string;
  switchToDark: string;
  switchToLight: string;
  switchLanguageLabel: string;

  // Home
  newExam: string;
  createExamAria: string;
  create: string;
  starting: string;
  unableToStart: string;
  joinSession: string;
  staffLinkPlaceholder: string;
  pasteLinkError: string;
  joinButton: string;

  // QR Scanner
  scanQrCode: string;
  closeQrScanner: string;
  qrScannerHint: string;
  qrScannerNoCamera: string;
  qrScannerBlocked: string;
  qrScannerNotExamQ: string;

  // Staff Join
  staffCheckIn: string;
  yourNamePlaceholder: string;
  joining: string;
  enterNameError: string;
  failedJoinError: string;

  // Staff View
  submitStudentAria: string;
  studentNumberPlaceholder: string;
  enterStudentError: string;
  maxCharsError: string;
  failedSubmitError: string;
  submitButton: string;
  addingButton: string;
  switchStaffTitle: string;
  muteAlerts: string;
  unmuteAlerts: string;
  reconnectingStaffTitle: string;
  reconnectingStaffBody: string;
  addedStatus: string;

  // Push Alerts
  pushOn: string;
  pushOff: string;
  pushBlocked: string;
  pushOnTitle: string;
  pushOffTitle: string;
  pushBlockedTitle: string;
  testSound: string;
  testSoundTitle: string;
  iosHelpButton: string;
  iosHelpTitle: string;
  iosHelpHint: string;
  pushUnsupported: string;
  pushNotConfigured: string;
  pushJoinFirst: string;
  pushDeniedError: string;
  pushDismissedError: string;
  liveInThisTab: string;
  testAlertRan: string;
  enableAlerts: string;
  turnOffAlerts: string;
  testLockScreen: string;
  pushStatusNotEnabled: string;
  pushStatusTestNeeded: string;
  pushStatusTestSent: string;
  pushStatusUnavailable: string;
  testLockScreenSent: string;
  wakeLockOn: string;
  wakeLockOff: string;
  acknowledge: string;
  coveredBy: string;
  authorName: string;
  authorRole: string;
  copyrightNotice: string;
  guideLabel: string;
  guideAria: string;
  backToApp: string;

  // Controller Dashboard
  timerButton: string;
  timerAria: string;
  qrButton: string;
  qrAria: string;
  staffButtonAria: string;
  clearSessionAria: string;
  forceClear: string;
  confirmClear: string;
  setupStep1Title: string;
  setupStep1Body: string;
  setupStep1Btn: string;
  setupStep2Title: string;
  setupStep2Body: string;
  setupStep2Btn: string;
  timerDrawerTitle: string;
  startTimeLabel: string;
  setStartNow: string;
  durationMinLabel: string;
  offsetMinLabel: string;
  blocksLegend: string;
  blockFirstLabel: string;
  blockLastLabel: string;
  blocksZeroHint: string;
  normalWindowLabel: string;
  resetBlocksBtn: string;
  confirmOverrideOnlyLabel: string;
  saveExamConfig: string;
  savingConfig: string;
  timerSaved: string;
  staffDrawerTitle: string;
  noStaffJoined: string;
  quickAddLabel: string;
  overrideLabel: string;
  addAndEnterBtn: string;
  addToQueueBtn: string;
  addingBtn: string;
  outPrefix: string;

  // QR Share Card
  shareStaffJoin: string;
  staffJoinLinkAria: string;
  copied: string;
  copyLink: string;
  rotating: string;
  newLink: string;

  // Queue Column
  maleQueueTitle: string;
  femaleQueueTitle: string;
  inBathroom: string;
  vacant: string;
  markReturned: string;
  enter: string;
  enterBathroomAria: string;
  moveUpAria: string;
  moveDownAria: string;
  removeAria: string;
  emptyQueue: string;
  waitingCount: string;
  waitingBadge: string;
  moreWaiting: string;

  // Alert Banner
  nextUp: string;
  dismissAlertAria: string;

  // Session Error / Recovery
  sessionNotFoundTitle: string;
  sessionNotFoundBody: string;
  startNewSession: string;
  backHome: string;
}

export const TRANSLATIONS: Record<Locale, Translations> = {
  en: {
    appName: "ExamQ",
    bathroomQueue: "Bathroom Queue",
    controller: "Controller",
    staff: "Staff",
    male: "Male",
    female: "Female",
    back: "Back",
    cancel: "Cancel",
    close: "Close",
    confirm: "Confirm",
    loading: "Loading",
    liveSync: "Live Sync",
    reconnecting: "Reconnecting…",
    reconnectingShort: "Reconnecting…",
    reconnectingNotice: "Reconnecting. Queue may be out of date.",
    switchToDark: "Switch to dark mode",
    switchToLight: "Switch to light mode",
    switchLanguageLabel: "Switch language to Thai",

    newExam: "New Exam",
    createExamAria: "Create Exam Session",
    create: "Create",
    starting: "Starting…",
    unableToStart: "Unable to start session.",
    joinSession: "Join Session",
    staffLinkPlaceholder: "Staff link or code",
    pasteLinkError: "Paste a staff link or enter a code.",
    joinButton: "Join",

    scanQrCode: "Scan QR code",
    closeQrScanner: "Close scanner",
    qrScannerHint: "Point camera at the controller's QR code.",
    qrScannerNoCamera: "Camera unavailable here. Paste the link below instead.",
    qrScannerBlocked: "Camera blocked. Paste the link below.",
    qrScannerNotExamQ: "Wrong QR. Use the staff invite.",

    staffCheckIn: "Staff Check-In",
    yourNamePlaceholder: "Your name or room",
    joining: "Joining…",
    enterNameError: "Enter your name or hall label.",
    failedJoinError: "Failed to join session.",

    submitStudentAria: "Submit Student to Bathroom Queue",
    studentNumberPlaceholder: "Student #",
    enterStudentError: "Enter a student number.",
    maxCharsError: "Max 32 characters.",
    failedSubmitError: "Failed to submit student.",
    submitButton: "Submit",
    addingButton: "Adding…",
    switchStaffTitle: "Switch Staff",
    muteAlerts: "Mute Alerts",
    unmuteAlerts: "Unmute Alerts",
    reconnectingStaffTitle: "Reconnecting. New submissions are paused.",
    reconnectingStaffBody:
      "The queue below is the last synced view. Your entry stays here while this page is open.",
    addedStatus: "added",

    pushOn: "Push On",
    pushOff: "Push",
    pushBlocked: "Blocked",
    pushOnTitle: "Background Push Alerts On (tap to turn off)",
    pushOffTitle: "Enable Background & Lock-Screen Push Alerts",
    pushBlockedTitle: "Notifications blocked in browser settings",
    testSound: "Test sound",
    testSoundTitle: "Test in-tab sound alert",
    iosHelpButton: "iPhone help",
    iosHelpTitle: "How to enable lock-screen alerts on iPhone",
    iosHelpHint:
      "iPhone lock-screen alerts: tap Share → Add to Home Screen, open ExamQ from Home Screen, then tap Push.",
    pushUnsupported: "Push notifications are not supported on this browser.",
    pushNotConfigured: "Push notifications are not configured on the server yet.",
    pushJoinFirst: "Join the session first to enable alerts.",
    pushDeniedError: "Notifications are blocked in browser settings.",
    pushDismissedError: "Notification permission was dismissed.",
    liveInThisTab: "Live in this tab",
    testAlertRan: "Test alert. Check volume if silent.",
    enableAlerts: "Enable alerts",
    turnOffAlerts: "Turn off",
    testLockScreen: "Test lock-screen alert",
    pushStatusNotEnabled: "Not enabled",
    pushStatusTestNeeded: "Test needed",
    pushStatusTestSent: "Test acknowledged",
    pushStatusUnavailable: "Unavailable",
    testLockScreenSent: "Test sent. Lock phone to verify quiet alert.",
    wakeLockOn: "Screen Awake",
    wakeLockOff: "Keep Awake",
    acknowledge: "Acknowledge",
    coveredBy: "Covered by",
    authorName: "Piyakawin Sodsoon",
    authorRole: "Creator & Developer",
    copyrightNotice: "© 2026 Piyakawin Sodsoon",
    guideLabel: "Guide",
    guideAria: "Open instruction manual",
    backToApp: "Back to ExamQ",

    timerButton: "Timer",
    timerAria: "Exam Timer Settings",
    qrButton: "QR",
    qrAria: "Share QR Code",
    staffButtonAria: "Connected Staff",
    clearSessionAria: "Clear Session",
    forceClear: "Force Clear",
    confirmClear: "Confirm Clear",
    setupStep1Title: "1 of 2 · Set up the exam",
    setupStep1Body: "Choose the start time and duration before opening the queue.",
    setupStep1Btn: "Set exam timer",
    setupStep2Title: "2 of 2 · Invite your proctors",
    setupStep2Body: "Share the staff QR or link. This step clears once the first proctor joins.",
    setupStep2Btn: "Invite proctors",
    timerDrawerTitle: "Exam Timer",
    startTimeLabel: "Start Time",
    setStartNow: "Set Start = Now",
    durationMinLabel: "Duration (min)",
    offsetMinLabel: "Offset (min)",
    blocksLegend: "Bathroom request blocks",
    blockFirstLabel: "Block first (minutes)",
    blockLastLabel: "Block last (minutes)",
    blocksZeroHint: "0 means no block.",
    normalWindowLabel: "Normal request window:",
    resetBlocksBtn: "Reset to 30 / 20",
    confirmOverrideOnlyLabel:
      "These blocks leave no normal bathroom window. Confirm override-only exam.",
    saveExamConfig: "Save Exam Config",
    savingConfig: "Saving…",
    timerSaved: "Timer saved.",
    staffDrawerTitle: "Checked In Staff",
    noStaffJoined: "No staff joined yet.",
    quickAddLabel: "Quick Add",
    overrideLabel: "Override",
    addAndEnterBtn: "Add & Enter",
    addToQueueBtn: "Add to Queue",
    addingBtn: "Adding…",
    outPrefix: "Out:",

    shareStaffJoin: "Share Staff Join",
    staffJoinLinkAria: "Staff Join Link",
    copied: "Copied",
    copyLink: "Copy",
    rotating: "Rotating…",
    newLink: "New Link",

    maleQueueTitle: "Male",
    femaleQueueTitle: "Female",
    inBathroom: "In Bathroom",
    vacant: "Vacant",
    markReturned: "Mark Returned",
    enter: "Enter",
    enterBathroomAria: "Enter Bathroom",
    moveUpAria: "Move Up",
    moveDownAria: "Move Down",
    removeAria: "Remove",
    emptyQueue: "Empty queue",
    waitingCount: "waiting",
    waitingBadge: "Waiting",
    moreWaiting: "more waiting",

    nextUp: "Next",
    dismissAlertAria: "Dismiss alert",

    sessionNotFoundTitle: "Session Not Found",
    sessionNotFoundBody: "Expired or invalid ID.",
    startNewSession: "Start New Session",
    backHome: "Back to Home",
  },
  th: {
    appName: "ExamQ",
    bathroomQueue: "คิวเข้าห้องน้ำห้องสอบ",
    controller: "ผู้คุมสอบหลัก",
    staff: "ผู้ช่วยคุมสอบ",
    male: "ชาย",
    female: "หญิง",
    back: "กลับ",
    cancel: "ยกเลิก",
    close: "ปิด",
    confirm: "ยืนยัน",
    loading: "กำลังโหลด",
    liveSync: "ซิงค์สด",
    reconnecting: "กำลังเชื่อมต่อใหม่…",
    reconnectingShort: "เชื่อมต่อใหม่",
    reconnectingNotice: "กำลังเชื่อมต่อใหม่ ข้อมูลคิวอาจไม่อัปเดต",
    switchToDark: "สลับเป็นโหมดมืด",
    switchToLight: "สลับเป็นโหมดสว่าง",
    switchLanguageLabel: "Switch language to English",

    newExam: "สร้างห้องสอบใหม่",
    createExamAria: "Create Exam Session",
    create: "สร้างห้อง",
    starting: "กำลังสร้าง…",
    unableToStart: "ไม่สามารถสร้างห้องสอบได้",
    joinSession: "เข้าร่วมห้องสอบ",
    staffLinkPlaceholder: "วางลิงก์หรือรหัสห้อง",
    pasteLinkError: "กรุณาวางลิงก์หรือกรอกรหัสห้องสอบ",
    joinButton: "เข้าร่วม",

    scanQrCode: "สแกน QR โค้ด",
    closeQrScanner: "ปิดกล้องสแกน QR",
    qrScannerHint: "เล็งกล้องไปที่ QR โค้ดของผู้คุมสอบหลัก",
    qrScannerNoCamera: "ไม่สามารถใช้กล้องได้ กรุณาวางลิงก์ด้านล่างแทน",
    qrScannerBlocked: "ไม่ได้รับอนุญาตใช้กล้อง กรุณาอนุญาตหรือวางลิงก์ด้านล่าง",
    qrScannerNotExamQ: "QR โค้ดนี้ไม่ใช่ลิงก์เข้าร่วม ExamQ",

    staffCheckIn: "ลงชื่อผู้ช่วยคุมสอบ",
    yourNamePlaceholder: "ชื่อหรือห้องสอบของคุณ",
    joining: "กำลังเข้าร่วม…",
    enterNameError: "กรุณากรอกชื่อของคุณ",
    failedJoinError: "เข้าร่วมห้องสอบไม่สำเร็จ",

    submitStudentAria: "ส่งเลขประจำตัวผู้เข้าสอบเข้าคิว",
    studentNumberPlaceholder: "เลขประจำตัวผู้เข้าสอบ",
    enterStudentError: "กรุณากรอกเลขประจำตัว",
    maxCharsError: "ไม่เกิน 32 ตัวอักษร",
    failedSubmitError: "ส่งข้อมูลไม่สำเร็จ",
    submitButton: "ส่งเข้าคิว",
    addingButton: "กำลังส่ง…",
    switchStaffTitle: "เปลี่ยนชื่อผู้ช่วย",
    muteAlerts: "ปิดเสียงเตือน",
    unmuteAlerts: "เปิดเสียงเตือน",
    reconnectingStaffTitle: "กำลังเชื่อมต่อใหม่ งดส่งคิวชั่วคราว",
    reconnectingStaffBody:
      "คิวด้านล่างเป็นข้อมูลล่าสุดก่อนหลุดการเชื่อมต่อ ข้อมูลที่พิมพ์ไว้จะยังคงอยู่",
    addedStatus: "เพิ่มเข้าคิวแล้ว",

    pushOn: "เปิดแจ้งเตือน",
    pushOff: "แจ้งเตือน",
    pushBlocked: "ถูกบล็อก",
    pushOnTitle: "เปิดแจ้งเตือนพื้นหลังแล้ว (แตะเพื่อปิด)",
    pushOffTitle: "เปิดแจ้งเตือนเมื่อล็อกหน้าจอ/พับแอป",
    pushBlockedTitle: "การแจ้งเตือนถูกบล็อกในการตั้งค่าเบราว์เซอร์",
    testSound: "ทดสอบเสียง",
    testSoundTitle: "ทดสอบเสียงแจ้งเตือนในหน้านี้",
    iosHelpButton: "วิธีตั้งค่า iPhone",
    iosHelpTitle: "วิธีเปิดแจ้งเตือนบนหน้าจอล็อก iPhone",
    iosHelpHint:
      "แจ้งเตือนหน้าจอล็อก iPhone: กด แชร์ → เพิ่มไปยังหน้าจอโฮม เปิด ExamQ จากหน้าจอโฮม แล้วกด แจ้งเตือน",
    pushUnsupported: "เบราว์เซอร์นี้ไม่รองรับการแจ้งเตือนแบบ Push",
    pushNotConfigured: "เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า Push",
    pushJoinFirst: "กรุณาเข้าร่วมห้องสอบก่อนเปิดแจ้งเตือน",
    pushDeniedError: "การแจ้งเตือนถูกปิดกั้นในการตั้งค่าเบราว์เซอร์",
    pushDismissedError: "ยกเลิกการขอสิทธิ์แจ้งเตือน",
    liveInThisTab: "แจ้งเตือนสดในแท็บนี้",
    testAlertRan: "ทดสอบแจ้งเตือนแล้ว หากไม่ได้ยินโปรดตรวจระดับเสียง",
    enableAlerts: "เปิดแจ้งเตือน",
    turnOffAlerts: "ปิดแจ้งเตือน",
    testLockScreen: "ทดสอบแจ้งเตือนหน้าจอล็อก",
    pushStatusNotEnabled: "ยังไม่เปิด",
    pushStatusTestNeeded: "รอทดสอบ",
    pushStatusTestSent: "ทดสอบแล้ว",
    pushStatusUnavailable: "ไม่พร้อมใช้งาน",
    testLockScreenSent: "ส่งทดสอบแล้ว ลองล็อกหน้าจอเพื่อตรวจสอบ",
    wakeLockOn: "เปิดจอค้างไว้",
    wakeLockOff: "กันจอดับ",
    acknowledge: "รับทราบ",
    coveredBy: "รับเรื่องโดย",
    authorName: "ปิยกวิน สดสุ่น",
    authorRole: "ผู้พัฒนาและออกแบบระบบ",
    copyrightNotice: "© 2026 ปิยกวิน สดสุ่น",
    guideLabel: "คู่มือ",
    guideAria: "เปิดคู่มือการใช้งาน",
    backToApp: "กลับหน้าหลัก",

    timerButton: "เวลา",
    timerAria: "ตั้งค่าเวลาสอบ",
    qrButton: "QR",
    qrAria: "แชร์ QR โค้ด",
    staffButtonAria: "ผู้ช่วยที่เข้าร่วม",
    clearSessionAria: "ล้างข้อมูลคิว",
    forceClear: "บังคับล้าง",
    confirmClear: "ยืนยันล้างคิว",
    setupStep1Title: "ขั้นตอน 1/2 · ตั้งเวลาสอบ",
    setupStep1Body: "กำหนดเวลาเริ่มและระยะเวลาสอบก่อนเปิดคิว",
    setupStep1Btn: "ตั้งเวลาสอบ",
    setupStep2Title: "ขั้นตอน 2/2 · เชิญผู้ช่วยคุมสอบ",
    setupStep2Body: "แชร์ QR หรือลิงก์ให้ผู้ช่วย ขั้นตอนนี้จะหายไปเมื่อมีผู้ช่วยเข้าร่วม",
    setupStep2Btn: "เชิญผู้ช่วย",
    timerDrawerTitle: "ตั้งเวลาสอบ",
    startTimeLabel: "เวลาเริ่มสอบ",
    setStartNow: "ตั้งเริ่ม = ตอนนี้",
    durationMinLabel: "ระยะเวลา (นาที)",
    offsetMinLabel: "ชดเชยเวลา (นาที)",
    blocksLegend: "ช่วงงดขอเข้าห้องน้ำ",
    blockFirstLabel: "งดช่วงต้น (นาที)",
    blockLastLabel: "งดช่วงท้าย (นาที)",
    blocksZeroHint: "0 คือไม่งด",
    normalWindowLabel: "ช่วงเปิดรับคิวปกติ:",
    resetBlocksBtn: "คืนค่า 30 / 20",
    confirmOverrideOnlyLabel:
      "ช่วงงดครอบคลุมเวลาสอบทั้งหมด ยืนยันเปิดใช้เฉพาะผู้คุมสอบหลักเท่านั้น",
    saveExamConfig: "บันทึกเวลาสอบ",
    savingConfig: "กำลังบันทึก…",
    timerSaved: "บันทึกเวลาสอบแล้ว",
    staffDrawerTitle: "ผู้ช่วยที่ลงชื่อแล้ว",
    noStaffJoined: "ยังไม่มีผู้ช่วยเข้าร่วม",
    quickAddLabel: "เพิ่มด่วน",
    overrideLabel: "กรณีพิเศษ",
    addAndEnterBtn: "เพิ่มและเข้าเลย",
    addToQueueBtn: "เพิ่มเข้าคิว",
    addingBtn: "กำลังเพิ่ม…",
    outPrefix: "อยู่ในห้องน้ำ:",

    shareStaffJoin: "แชร์ลิงก์ผู้ช่วย",
    staffJoinLinkAria: "Staff Join Link",
    copied: "คัดลอกแล้ว",
    copyLink: "คัดลอก",
    rotating: "กำลังเปลี่ยน…",
    newLink: "ลิงก์ใหม่",

    maleQueueTitle: "ชาย",
    femaleQueueTitle: "หญิง",
    inBathroom: "กำลังเข้าห้องน้ำ",
    vacant: "ว่าง",
    markReturned: "กลับแล้ว",
    enter: "เข้า",
    enterBathroomAria: "Enter Bathroom",
    moveUpAria: "เลื่อนขึ้น",
    moveDownAria: "เลื่อนลง",
    removeAria: "นำออก",
    emptyQueue: "ไม่มีคิว",
    waitingCount: "คนรอ",
    waitingBadge: "รอคิว",
    moreWaiting: "คนรอเพิ่มเติม",

    nextUp: "คิวถัดไป",
    dismissAlertAria: "ปิดการแจ้งเตือน",

    sessionNotFoundTitle: "ไม่พบห้องสอบ",
    sessionNotFoundBody: "ลิงก์หมดอายุหรือรหัสไม่ถูกต้อง",
    startNewSession: "สร้างห้องสอบใหม่",
    backHome: "หน้าหลัก",
  },
};
