import type { Locale } from "./translations";

export type GuideRole = "all" | "controller" | "staff";

export interface GuideStep {
  num: number;
  color: string;
  action: string;
  detail: string;
}

export interface GuideSection {
  id: string;
  role: GuideRole;
  image: string;
  title: string;
  subtitle: string;
  steps: GuideStep[];
  tip?: string;
}

export interface GuideBundle {
  heroTitle: string;
  heroSubtitle: string;
  allRoles: string;
  roleLabels: Record<GuideRole, string>;
  tipLabel: string;
  printBtn: string;
  sections: GuideSection[];
}

export const GUIDE_CONTENT: Record<Locale, GuideBundle> = {
  en: {
    heroTitle: "ExamQ User Manual",
    heroSubtitle:
      "Click-by-click visual guide for Exam Controllers and Row Proctors. Follow the numbered arrows on each screen.",
    allRoles: "All",
    roleLabels: {
      all: "All Users",
      controller: "Controller",
      staff: "Staff Proctor",
    },
    tipLabel: "Exam-Day Tip",
    printBtn: "Print / Save PDF",
    sections: [
      {
        id: "home-onboarding",
        role: "all",
        image: "/guide/01-home.png",
        title: "1. Home Page & Onboarding",
        subtitle:
          "Start a new exam room as the Controller, or join an existing room as a Staff Proctor.",
        steps: [
          {
            num: 1,
            color: "#0284c7",
            action: "Click “ไทย” / “EN”",
            detail:
              "Switch the entire interface between English and Thai at any time. Your choice is saved automatically.",
          },
          {
            num: 2,
            color: "#0284c7",
            action: "Click the Moon / Sun icon",
            detail:
              "Toggle between Light Mode and Dark Mode (ideal for dimmed or bright exam halls).",
          },
          {
            num: 3,
            color: "#059669",
            action: "Controller: Click “Create”",
            detail:
              "Creates a brand-new exam session and opens your private Controller Dashboard. Keep this tab open or bookmark the URL.",
          },
          {
            num: 4,
            color: "#2563eb",
            action: "Staff: Click “Scan QR code”",
            detail:
              "Opens your device camera to scan the Controller’s QR code and jump straight into the room.",
          },
          {
            num: 5,
            color: "#2563eb",
            action: "Staff: Paste link or code",
            detail:
              "If camera access is unavailable, paste the full invite URL or session code sent by the Controller.",
          },
          {
            num: 6,
            color: "#2563eb",
            action: "Staff: Click “Join”",
            detail:
              "Opens the Staff Check-In screen for that exam session.",
          },
        ],
        tip: "Controllers should click Create once per exam hall. Staff proctors should only use Scan QR code or Join.",
      },
      {
        id: "controller-timer",
        role: "controller",
        image: "/guide/02-controller-timer.png",
        title: "2. Exam Timer & Request Blocks",
        subtitle:
          "Configure exam start time, duration, and automatic no-bathroom windows (e.g., first 30 min and last 20 min).",
        steps: [
          {
            num: 1,
            color: "#0284c7",
            action: "Click “Timer” in the top bar",
            detail:
              "Opens or closes the Exam Timer settings drawer.",
          },
          {
            num: 2,
            color: "#059669",
            action: "Set “Start Time”",
            detail:
              "Pick the exact date and time the exam begins.",
          },
          {
            num: 3,
            color: "#059669",
            action: "Or click “Set Start = Now”",
            detail:
              "One-click shortcut to set the start time to the current clock time.",
          },
          {
            num: 4,
            color: "#059669",
            action: "Enter “Duration (min)”",
            detail:
              "Total exam length in minutes (e.g., 120 for a 2-hour exam). You can also add an Offset (min) if needed.",
          },
          {
            num: 5,
            color: "#d97706",
            action: "Adjust “Block first” & “Block last”",
            detail:
              "Sets how many minutes at the start (default 30) and end (default 20) block normal staff submissions. Set 0 for no block.",
          },
          {
            num: 6,
            color: "#059669",
            action: "Click “Save Exam Config”",
            detail:
              "Applies the schedule immediately across all Controller and Staff devices and updates the live timeline bar.",
          },
        ],
        tip: "The live timeline bar turns amber during blocked windows and green when normal bathroom requests are open.",
      },
      {
        id: "controller-share",
        role: "controller",
        image: "/guide/03-controller-share.png",
        title: "3. Inviting Staff & Managing Links",
        subtitle:
          "Share a scannable QR code or invite link with row proctors, rotate links for security, and view who is checked in.",
        steps: [
          {
            num: 1,
            color: "#0284c7",
            action: "Click “QR” in the top bar",
            detail:
              "Opens the Share Staff Join panel with a live QR code and invite URL.",
          },
          {
            num: 2,
            color: "#2563eb",
            action: "Let proctors scan the QR code",
            detail:
              "Proctors point their phone camera (or ExamQ’s Home scanner) at this QR code to join without typing.",
          },
          {
            num: 3,
            color: "#059669",
            action: "Click “Copy”",
            detail:
              "Copies the Staff Join Link to your clipboard so you can send it via LINE, chat, or email.",
          },
          {
            num: 4,
            color: "#d97706",
            action: "Click “New Link” (Rotate Invite)",
            detail:
              "Generates a fresh invite code and invalidates old links if an invite was shared outside the room.",
          },
          {
            num: 5,
            color: "#7c3aed",
            action: "Click the Staff count button",
            detail:
              "Opens the Checked In Staff drawer to see every proctor currently connected to your room.",
          },
        ],
      },
      {
        id: "staff-join",
        role: "staff",
        image: "/guide/04-staff-join.png",
        title: "4. Staff Check-In",
        subtitle:
          "Proctors enter their row or hall label once so every queue request shows who submitted it.",
        steps: [
          {
            num: 1,
            color: "#0284c7",
            action: "Optional: Click “ไทย” / “EN”",
            detail:
              "Switch to your preferred language before or after joining.",
          },
          {
            num: 2,
            color: "#2563eb",
            action: "Type your name or row (e.g., “Row A”)",
            detail:
              "This label appears beside every student you submit so the Controller knows which row the student is from.",
          },
          {
            num: 3,
            color: "#059669",
            action: "Click “Join Session”",
            detail:
              "Checks you into the exam room and saves your proctor session locally across page reloads.",
          },
        ],
      },
      {
        id: "queue-submit",
        role: "staff",
        image: "/guide/05-queue-submit.png",
        title: "5. Submitting Students to the Queue",
        subtitle:
          "Proctors submit student numbers with gender separation and automatic duplicate protection.",
        steps: [
          {
            num: 1,
            color: "#059669",
            action: "Check the Window Status badge",
            detail:
              "Shows “Bathroom Window Open” (green) when normal requests are allowed, or amber when blocked.",
          },
          {
            num: 2,
            color: "#2563eb",
            action: "Enter “Student #”",
            detail:
              "Type the student’s seat or ID number (up to 32 characters). Duplicate active numbers are automatically blocked.",
          },
          {
            num: 3,
            color: "#2563eb",
            action: "Select “Male” or “Female”",
            detail:
              "Assigns the student to the Male or Female queue column (1 Male and 1 Female may use the bathroom concurrently).",
          },
          {
            num: 4,
            color: "#059669",
            action: "Click “Submit”",
            detail:
              "Adds the student to the waiting queue and syncs immediately to the Controller and all other proctors.",
          },
          {
            num: 5,
            color: "#7c3aed",
            action: "Watch the live queue columns",
            detail:
              "See who is currently In Bathroom, who is tagged NEXT, and your position in the waiting list.",
          },
        ],
      },
      {
        id: "controller-queue",
        role: "controller",
        image: "/guide/06-controller-queue.png",
        title: "6. Managing the Live Queue (Controller)",
        subtitle:
          "Admit students into the bathroom, mark returns to alert everyone, reorder waiting students, or use emergency overrides.",
        steps: [
          {
            num: 1,
            color: "#d97706",
            action: "Monitor “In Bathroom” occupancy",
            detail:
              "Shows the student currently inside the Male or Female bathroom (or “Vacant” when empty). Max 1 per gender.",
          },
          {
            num: 2,
            color: "#059669",
            action: "Click “Mark Returned”",
            detail:
              "Marks the current student as back in their seat, frees the bathroom, and automatically fires a Next-Up alert to all devices!",
          },
          {
            num: 3,
            color: "#2563eb",
            action: "Click the Enter (→) button",
            detail:
              "Sends the waiting student into the bathroom. Blocked if that gender’s bathroom is already occupied.",
          },
          {
            num: 4,
            color: "#7c3aed",
            action: "Click Up (↑) / Down (↓)",
            detail:
              "Reorders waiting students if an urgent case needs priority.",
          },
          {
            num: 5,
            color: "#dc2626",
            action: "Click the Trash icon",
            detail:
              "Removes a waiting student from the queue (for example, if they no longer need to go).",
          },
          {
            num: 6,
            color: "#0284c7",
            action: "Quick Add & “Override”",
            detail:
              "Controllers can add students directly at any time. Toggle “Override” during blocked windows to add or enter emergency cases.",
          },
        ],
      },
      {
        id: "alerts-push",
        role: "all",
        image: "/guide/07-alerts-push.png",
        title: "7. Turn-Ready Alerts, Sound & Push",
        subtitle:
          "Every time a student returns from the bathroom, all proctors and the Controller receive an instant Next-Up alert.",
        steps: [
          {
            num: 1,
            color: "#059669",
            action: "Watch the “NEXT MALE / FEMALE” Banner",
            detail:
              "Appears automatically on all devices whenever someone returns and a waiting student is next in line, accompanied by a gentle chime and vibration.",
          },
          {
            num: 2,
            color: "#059669",
            action: "Click “Acknowledge” (or X)",
            detail:
              "Confirms you saw the alert and broadcasts “Covered by [Your Name]” so other proctors know the student is being escorted.",
          },
          {
            num: 3,
            color: "#2563eb",
            action: "Click the Bell icon",
            detail:
              "Mute or unmute sound and vibration alerts in the current browser tab.",
          },
          {
            num: 4,
            color: "#7c3aed",
            action: "Click your Staff Badge",
            detail:
              "Switch your proctor name/row label if someone else takes over your device.",
          },
        ],
        tip: "When Push Notifications are configured on HTTPS (like Vercel), tap “Push” + “Keep Awake” to receive quiet lock-screen alerts even when your phone sleeps.",
      },
      {
        id: "reset-sync",
        role: "controller",
        image: "/guide/08-reset-sync.png",
        title: "8. Session Reset, Sync & Guide Access",
        subtitle:
          "Safely clear the queue between back-to-back exams and access this manual anytime.",
        steps: [
          {
            num: 1,
            color: "#dc2626",
            action: "Click Reset (↻) → “Confirm Clear”",
            detail:
              "Two-step confirmation clears all queue entries so you can reuse the same room link for the next exam period without losing your proctors.",
          },
          {
            num: 2,
            color: "#0284c7",
            action: "Click “Guide” in the top bar",
            detail:
              "Opens this bilingual manual from any screen in ExamQ.",
          },
          {
            num: 3,
            color: "#475569",
            action: "Footer Links",
            detail:
              "Quick access to the Guide and the GitHub repository credits at the bottom of every page.",
          },
        ],
      },
    ],
  },
  th: {
    heroTitle: "คู่มือการใช้งาน ExamQ",
    heroSubtitle:
      "คู่มือแนะนำการใช้งานแบบทีละคลิก พร้อมภาพหน้าจอและลูกศรชี้ตำแหน่งสำหรับผู้คุมห้องสอบและผู้ช่วยคุมสอบ",
    allRoles: "ทั้งหมด",
    roleLabels: {
      all: "ทุกบทบาท",
      controller: "ผู้คุมห้อง (Controller)",
      staff: "ผู้ช่วยคุมสอบ (Staff)",
    },
    tipLabel: "คำแนะนำวันสอบ",
    printBtn: "พิมพ์ / บันทึก PDF",
    sections: [
      {
        id: "home-onboarding",
        role: "all",
        image: "/guide/01-home.png",
        title: "1. หน้าหลักและการเข้าใช้งาน",
        subtitle:
          "เริ่มห้องสอบใหม่ในฐานะผู้คุมห้อง (Controller) หรือเข้าร่วมห้องสอบที่มีอยู่แล้วในฐานะผู้ช่วยคุมสอบ (Staff)",
        steps: [
          {
            num: 1,
            color: "#0284c7",
            action: "คลิก “ไทย” / “EN”",
            detail:
              "สลับภาษาของระบบระหว่างภาษาไทยและภาษาอังกฤษได้ตลอดเวลา ระบบจะจำค่าที่เลือกไว้ให้อัตโนมัติ",
          },
          {
            num: 2,
            color: "#0284c7",
            action: "คลิกไอคอนพระจันทร์ / พระอาทิตย์",
            detail:
              "สลับโหมดสว่าง (Light Mode) และโหมดมืด (Dark Mode) ให้เหมาะกับแสงในห้องสอบ",
          },
          {
            num: 3,
            color: "#059669",
            action: "ผู้คุมห้อง: คลิก “สร้าง” (Create)",
            detail:
              "สร้างห้องสอบใหม่และเปิดหน้าจัดการของผู้คุมห้อง ควรเปิดหน้านี้ค้างไว้หรือบุ๊กมาร์กลิงก์ไว้",
          },
          {
            num: 4,
            color: "#2563eb",
            action: "ผู้ช่วย: คลิก “สแกน QR โค้ด”",
            detail:
              "เปิดกล้องมือถือหรือแท็บเล็ตเพื่อสแกน QR โค้ดจากหน้าจอผู้คุมห้องและเข้าสู่ห้องสอบทันที",
          },
          {
            num: 5,
            color: "#2563eb",
            action: "ผู้ช่วย: วางลิงก์หรือรหัสห้อง",
            detail:
              "หากไม่สามารถใช้กล้องได้ สามารถวางลิงก์เชิญหรือรหัสห้องที่ได้รับจากผู้คุมห้องในช่องนี้",
          },
          {
            num: 6,
            color: "#2563eb",
            action: "ผู้ช่วย: คลิก “เข้าร่วม” (Join)",
            detail:
              "เข้าสู่หน้าลงชื่อผู้ช่วยคุมสอบของห้องนั้นๆ",
          },
        ],
        tip: "ผู้คุมห้องควรกด “สร้าง” เพียง 1 ครั้งต่อ 1 ห้องสอบ ส่วนผู้ช่วยคุมสอบให้ใช้ “สแกน QR โค้ด” หรือ “เข้าร่วม” เท่านั้น",
      },
      {
        id: "controller-timer",
        role: "controller",
        image: "/guide/02-controller-timer.png",
        title: "2. ตั้งเวลาสอบและช่วงงดขอเข้าห้องน้ำ",
        subtitle:
          "กำหนดเวลาเริ่มสอบ ระยะเวลาสอบ และช่วงงดขอเข้าห้องน้ำอัตโนมัติ (เช่น ช่วงต้น 30 นาที และช่วงท้าย 20 นาที)",
        steps: [
          {
            num: 1,
            color: "#0284c7",
            action: "คลิก “เวลา” (Timer) บนแถบด้านบน",
            detail:
              "เปิดหรือปิดหน้าต่างตั้งค่าเวลาสอบ",
          },
          {
            num: 2,
            color: "#059669",
            action: "กำหนด “เวลาเริ่มสอบ”",
            detail:
              "เลือกวันและเวลาที่เริ่มทำการสอบ",
          },
          {
            num: 3,
            color: "#059669",
            action: "หรือคลิก “ตั้งเริ่ม = ตอนนี้”",
            detail:
              "ปุ่มลัดตั้งเวลาเริ่มสอบให้ตรงกับเวลาปัจจุบันทันทีในคลิกเดียว",
          },
          {
            num: 4,
            color: "#059669",
            action: "กรอก “ระยะเวลา (นาที)”",
            detail:
              "ระยะเวลาสอบทั้งหมดเป็นนาที (เช่น 120 นาทีสำหรับสอบ 2 ชั่วโมง) และสามารถใส่เวลาชดเชย (Offset) ได้",
          },
          {
            num: 5,
            color: "#d97706",
            action: "ปรับ “งดช่วงต้น” และ “งดช่วงท้าย”",
            detail:
              "กำหนดจำนวนนาทีแรก (ค่าเริ่มต้น 30) และนาทีสุดท้าย (ค่าเริ่มต้น 20) ที่งดรับคิวปกติ หากใส่ 0 คือไม่งด",
          },
          {
            num: 6,
            color: "#059669",
            action: "คลิก “บันทึกเวลาสอบ”",
            detail:
              "บันทึกการตั้งค่าและซิงค์ไปยังทุกอุปกรณ์ทันที พร้อมอัปเดตแถบไทม์ไลน์สด",
          },
        ],
        tip: "แถบไทม์ไลน์จะแสดงสีเหลืองอำพันในช่วงงดขอเข้าห้องน้ำ และเปลี่ยนเป็นสีเขียวเมื่อเปิดรับคิวปกติ",
      },
      {
        id: "controller-share",
        role: "controller",
        image: "/guide/03-controller-share.png",
        title: "3. เชิญผู้ช่วยคุมสอบและจัดการลิงก์",
        subtitle:
          "แชร์ QR โค้ดหรือลิงก์ให้ผู้ช่วยคุมสอบ เปลี่ยนลิงก์ใหม่เพื่อความปลอดภัย และตรวจสอบรายชื่อผู้ช่วยที่เข้าห้องแล้ว",
        steps: [
          {
            num: 1,
            color: "#0284c7",
            action: "คลิก “QR” บนแถบด้านบน",
            detail:
              "เปิดการ์ดแชร์ลิงก์และ QR โค้ดสำหรับผู้ช่วยคุมสอบ",
          },
          {
            num: 2,
            color: "#2563eb",
            action: "ให้ผู้ช่วยสแกน QR โค้ด",
            detail:
              "ผู้ช่วยใช้กล้องมือถือสแกน QR โค้ดนี้เพื่อเข้าห้องสอบได้ทันทีโดยไม่ต้องพิมพ์ลิงก์",
          },
          {
            num: 3,
            color: "#059669",
            action: "คลิก “คัดลอก” (Copy)",
            detail:
              "คัดลอกลิงก์เชิญลงคลิปบอร์ดเพื่อส่งต่อทาง LINE หรือแชทกลุ่มคุมสอบ",
          },
          {
            num: 4,
            color: "#d97706",
            action: "คลิก “ลิงก์ใหม่” (Rotate)",
            detail:
              "สร้างรหัสเชิญใหม่และยกเลิกลิงก์เก่าทันที หากเผลอแชร์ลิงก์ออกไปนอกห้องสอบ",
          },
          {
            num: 5,
            color: "#7c3aed",
            action: "คลิกปุ่มจำนวนผู้ช่วย (รูปคน)",
            detail:
              "เปิดดูรายชื่อผู้ช่วยคุมสอบทุกคนที่ลงชื่อเข้าร่วมห้องสอบนี้แล้ว",
          },
        ],
      },
      {
        id: "staff-join",
        role: "staff",
        image: "/guide/04-staff-join.png",
        title: "4. การลงชื่อเข้าห้องของผู้ช่วยคุมสอบ",
        subtitle:
          "ผู้ช่วยคุมสอบกรอกชื่อหรือตำแหน่งแถวของตนเองเพียงครั้งเดียว เพื่อให้ทุกคิวที่ส่งระบุที่มาได้ชัดเจน",
        steps: [
          {
            num: 1,
            color: "#0284c7",
            action: "เลือกภาษา “ไทย” / “EN” (ถ้าต้องการ)",
            detail:
              "สามารถสลับภาษาได้ทั้งก่อนและหลังเข้าห้องสอบ",
          },
          {
            num: 2,
            color: "#2563eb",
            action: "กรอกชื่อหรือแถวที่ดูแล (เช่น “แถว A”)",
            detail:
              "ชื่อนี้จะแสดงกำกับอยู่ใต้เลขประจำตัวนักศึกษาทุกครั้งที่คุณส่งคิวเข้าสู่ระบบ",
          },
          {
            num: 3,
            color: "#059669",
            action: "คลิก “เข้าร่วมห้องสอบ” (Join Session)",
            detail:
              "ยืนยันตัวตนเข้าสู่ห้องสอบ ระบบจะจำสถานะไว้แม้รีเฟรชหน้าจอ",
          },
        ],
      },
      {
        id: "queue-submit",
        role: "staff",
        image: "/guide/05-queue-submit.png",
        title: "5. การส่งคำขอเข้าคิวห้องน้ำ",
        subtitle:
          "ผู้ช่วยคุมสอบกรอกเลขที่นักศึกษาและเลือกเพศ พร้อมระบบป้องกันการส่งเลขซ้ำอัตโนมัติ",
        steps: [
          {
            num: 1,
            color: "#059669",
            action: "ดูป้ายสถานะเวลาสอบ",
            detail:
              "สีเขียว (“เปิดรับคิวปกติ”) คือส่งคิวได้ตามปกติ หากเป็นสีเหลืองอำพันแสดงว่าอยู่ในช่วงงดขอเข้าห้องน้ำ",
          },
          {
            num: 2,
            color: "#2563eb",
            action: "กรอก “เลขประจำตัว / เลขที่นั่ง”",
            detail:
              "พิมพ์เลขที่นักศึกษา (สูงสุด 32 ตัวอักษร) ระบบจะป้องกันไม่ให้ส่งเลขที่ยังอยู่ในคิวซ้ำ",
          },
          {
            num: 3,
            color: "#2563eb",
            action: "เลือก “ชาย” หรือ “หญิง”",
            detail:
              "แยกคิวชายและหญิงอิสระจากกัน (เข้าห้องน้ำได้พร้อมกันสูงสุดเพศละ 1 คน)",
          },
          {
            num: 4,
            color: "#059669",
            action: "คลิก “ส่งเข้าคิว” (Submit)",
            detail:
              "เพิ่มนักศึกษาเข้าสู่คิวรอและซิงค์ไปยังหน้าจอผู้คุมห้องและผู้ช่วยทุกคนทันที",
          },
          {
            num: 5,
            color: "#7c3aed",
            action: "ติดตามคิวแบบเรียลไทม์",
            detail:
              "ตรวจสอบได้ว่าใครกำลังอยู่ในห้องน้ำ ใครเป็นคิวถัดไป (NEXT) และมีคิวรอกี่คน",
          },
        ],
      },
      {
        id: "controller-queue",
        role: "controller",
        image: "/guide/06-controller-queue.png",
        title: "6. การจัดการคิวสด (ผู้คุมห้อง)",
        subtitle:
          "กดให้นักศึกษาเข้าห้องน้ำ กดรับกลับเพื่อแจ้งเตือนคิวถัดไป จัดลำดับคิว หรือเพิ่มคิวกรณีฉุกเฉิน",
        steps: [
          {
            num: 1,
            color: "#d97706",
            action: "ดูช่อง “กำลังเข้าห้องน้ำ”",
            detail:
              "แสดงเลขที่นักศึกษาที่อยู่ในห้องน้ำชาย/หญิงขณะนั้น หรือแสดง “ว่าง” เมื่อไม่มีคนเข้า",
          },
          {
            num: 2,
            color: "#059669",
            action: "คลิก “กลับแล้ว” (Mark Returned)",
            detail:
              "บันทึกว่านักศึกษากลับเข้าห้องสอบแล้ว ทำให้ห้องน้ำว่าง และส่งแจ้งเตือน “คิวถัดไป” ไปยังทุกเครื่องทันที!",
          },
          {
            num: 3,
            color: "#2563eb",
            action: "คลิกปุ่มเข้าห้องน้ำ (→)",
            detail:
              "เรียกนักศึกษาที่รอคิวอยู่ให้เข้าห้องน้ำ (กดได้เมื่อห้องน้ำของเพศนั้นว่างอยู่เท่านั้น)",
          },
          {
            num: 4,
            color: "#7c3aed",
            action: "คลิกเลื่อนขึ้น (↑) / เลื่อนลง (↓)",
            detail:
              "ปรับลำดับคิวรอได้ทันทีเมื่อมีกรณีเร่งด่วน",
          },
          {
            num: 5,
            color: "#dc2626",
            action: "คลิกไอคอนถังขยะ (นำออก)",
            detail:
              "ลบนักศึกษาออกจากคิวรอ (เช่น กรณีนักศึกษาเปลี่ยนใจไม่เข้าห้องน้ำแล้ว)",
          },
          {
            num: 6,
            color: "#0284c7",
            action: "เพิ่มด่วน และ “กรณีพิเศษ” (Override)",
            detail:
              "ผู้คุมห้องสามารถเพิ่มนักศึกษาได้ตลอดเวลา และเปิด “กรณีพิเศษ” เพื่อเพิ่มหรือให้เข้าห้องน้ำได้แม้ในช่วงงดปกติ",
          },
        ],
      },
      {
        id: "alerts-push",
        role: "all",
        image: "/guide/07-alerts-push.png",
        title: "7. ระบบแจ้งเตือนคิวถัดไป เสียง และ Push",
        subtitle:
          "ทุกครั้งที่มีนักศึกษากลับจากห้องน้ำ ทุกเครื่องจะได้รับแจ้งเตือนคิวถัดไปพร้อมกันทันที",
        steps: [
          {
            num: 1,
            color: "#059669",
            action: "แถบแจ้งเตือน “คิวถัดไป” (NEXT)",
            detail:
              "เด้งขึ้นบนหน้าจอทุกเครื่องโดยอัตโนมัติเมื่อมีคนกลับจากห้องน้ำและมีคิวรอถัดไป พร้อมเสียงเตือนและระบบสั่น",
          },
          {
            num: 2,
            color: "#059669",
            action: "คลิก “รับทราบ” (Acknowledge) หรือ X",
            detail:
              "กดเพื่อยืนยันว่ากำลังพานักศึกษาไปเข้าห้องน้ำ ระบบจะแสดงชื่อผู้รับเรื่องให้ผู้ช่วยคนอื่นเห็นตรงกัน",
          },
          {
            num: 3,
            color: "#2563eb",
            action: "คลิกไอคอนกระดิ่ง",
            detail:
              "เปิดหรือปิดเสียงและระบบสั่นแจ้งเตือนในแท็บเบราว์เซอร์นี้",
          },
          {
            num: 4,
            color: "#7c3aed",
            action: "คลิกป้ายชื่อผู้ช่วย",
            detail:
              "สลับชื่อผู้ช่วยคุมสอบหากมีการเปลี่ยนเวรดูแลเครื่อง",
          },
        ],
        tip: "เมื่อใช้งานบน HTTPS (เช่น Vercel) สามารถกด “Push” และ “กันจอดับ” เพื่อรับการแจ้งเตือนแบบเงียบแม้หน้าจอมือถือล็อกอยู่",
      },
      {
        id: "reset-sync",
        role: "controller",
        image: "/guide/08-reset-sync.png",
        title: "8. การล้างคิวเริ่มรอบใหม่ และคู่มือ",
        subtitle:
          "ล้างคิวระหว่างวิชาสอบได้อย่างปลอดภัย และเปิดดูคู่มือนี้ได้จากทุกหน้า",
        steps: [
          {
            num: 1,
            color: "#dc2626",
            action: "คลิกไอคอนรีเซ็ต (↻) → “ยืนยันล้างคิว”",
            detail:
              "ยืนยัน 2 ขั้นตอนเพื่อล้างรายชื่อนักศึกษาทั้งหมดสำหรับเริ่มสอบวิชาถัดไป โดยที่ผู้ช่วยยังอยู่ในห้องเดิม",
          },
          {
            num: 2,
            color: "#0284c7",
            action: "คลิก “คู่มือ” (Guide) ที่แถบด้านบน",
            detail:
              "เปิดคู่มือการใช้งาน 2 ภาษานี้ได้จากทุกหน้าของ ExamQ",
          },
          {
            num: 3,
            color: "#475569",
            action: "แถบข้อมูลด้านล่าง (Footer)",
            detail:
              "เข้าถึงคู่มือและลิงก์ GitHub ของผู้พัฒนาได้จากด้านล่างของทุกหน้า",
          },
        ],
      },
    ],
  },
};
