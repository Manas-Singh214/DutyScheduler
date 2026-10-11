import { Document, Paragraph, Table, TableRow, TableCell, TextRun, AlignmentType, WidthType, Packer } from 'docx';
import { saveAs } from 'file-saver';

function groupSessionsIntoShifts(schedule) {
  const sessionsByDate = new Map();
  schedule.forEach(session => {
    const sessions = sessionsByDate.get(session.date) || [];
    sessions.push(session);
    sessionsByDate.set(session.date, sessions);
  });

  const hasMultipleSessionsPerDate = [...sessionsByDate.values()].some(sessions => sessions.length > 1);
  const pairs = [];

  if (hasMultipleSessionsPerDate) {
    sessionsByDate.forEach((sessions, date) => {
      for (let index = 0; index < sessions.length; index += 2) {
        pairs.push({ date, shift1: sessions[index], shift2: sessions[index + 1] || null });
      }
    });
  } else if (schedule.length > 1 && schedule.length % 2 === 0) {
    for (let index = 0; index < schedule.length; index += 2) {
      const shift1 = schedule[index];
      const shift2 = schedule[index + 1];
      pairs.push({ date: shift1.date, shift1, shift2 });
    }
  } else {
    for (let index = 0; index < schedule.length; index += 2) {
      pairs.push({ date: schedule[index].date, shift1: schedule[index], shift2: schedule[index + 1] || null });
    }
  }

  return pairs;
}

export async function exportDocxClientSide(allocationData) {
  const { school_name, exam_name, schedule, fairness_matrix } = allocationData;

  const docChildren = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: (school_name || "SCHOOL").toUpperCase(),
          bold: true,
          size: 32, // 16pt
          color: "1E293B",
          font: "Calibri"
        })
      ]
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: exam_name || "Examination Schedule",
          bold: true,
          size: 26, // 13pt
          color: "2563EB",
          font: "Calibri"
        })
      ]
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: "OFFICIAL EXAM DUTY INVIGILATION SCHEDULE",
          bold: true,
          size: 20, // 10pt
          color: "64748B",
          font: "Calibri"
        })
      ]
    }),
  ];

  const allTeachers = fairness_matrix.map(item => item.teacher);
  const shiftGroups = groupSessionsIntoShifts(schedule);

  shiftGroups.forEach((group, groupIndex) => {
    const { shift1, shift2 } = group;
    docChildren.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `Exam Date: ${group.date}`,
            bold: true,
            size: 24,
            color: "0F172A",
            font: "Calibri"
          })
        ]
      })
    );

    const sessionSummary = `Shift 1: ${shift1.session_name} (${shift1.time_slot})${shift2 ? `   |   Shift 2: ${shift2.session_name} (${shift2.time_slot})` : ''}`;
    docChildren.push(new Paragraph({ children: [new TextRun({ text: sessionSummary, italics: true, size: 18, color: "64748B", font: "Calibri" })] }));

    const shift1Map = new Map(shift1.assignments.map(assignment => [assignment.room, assignment.teacher]));
    const shift2Map = new Map((shift2?.assignments || []).map(assignment => [assignment.room, assignment.teacher]));
    const rooms = [...new Set([...shift1Map.keys(), ...shift2Map.keys()])];
    const makeCell = (text, index, header = false) => new TableCell({
      width: { size: [2000, 3750, 3750][index], type: WidthType.DXA },
      shading: { fill: header ? "2F6B57" : (groupIndex % 2 ? "F4F7F5" : "FFFFFF") },
      children: [new Paragraph({ children: [new TextRun({
        text,
        bold: header || index === 0,
        color: header ? "FFFFFF" : "1F2933",
        font: "Calibri",
        size: 18
      })] })]
    });

    const tableRows = [
      new TableRow({
        tableHeader: true,
        children: [
          makeCell("Room No.", 0, true),
          makeCell(`Duty Shift 1 - Teacher Name\n${shift1.session_name}`, 1, true),
          makeCell(`Duty Shift 2 - Teacher Name\n${shift2?.session_name || "No Exam"}`, 2, true)
        ]
      })
    ];

    rooms.forEach(room => {
      tableRows.push(
        new TableRow({
          children: [
            makeCell(room, 0),
            makeCell(shift1Map.get(room) || "—", 1),
            makeCell(shift2 ? shift2Map.get(room) || "—" : "— (No Exam)", 2)
          ]
        })
      );
    });

    docChildren.push(new Table({ width: { size: 9500, type: WidthType.DXA }, rows: tableRows }));
    docChildren.push(new Paragraph({ children: [new TextRun({ text: "Remaining and Free Teachers", bold: true, size: 20, color: "1F2933", font: "Calibri" })] }));

    const shift1Assigned = new Set(shift1Map.values());
    const shift2Assigned = new Set(shift2Map.values());
    const freeShift1 = allTeachers.filter(teacher => !shift1Assigned.has(teacher));
    const freeShift2 = allTeachers.filter(teacher => !shift2Assigned.has(teacher));
    const freeFullDay = allTeachers.filter(teacher => !shift1Assigned.has(teacher) && !shift2Assigned.has(teacher));
    const freeLine = (label, teachers) => new Paragraph({
      spacing: { before: 0, after: 0 },
      children: [new TextRun({ text: `${label} (${teachers.length}): `, bold: true, size: 18, font: "Calibri" }), new TextRun({ text: teachers.join(" · ") || "None", size: 18, font: "Calibri" })]
    });

    docChildren.push(freeLine("Shift 1 Free", freeShift1));
    if (shift2) docChildren.push(freeLine("Shift 2 Free", freeShift2));
    if (freeFullDay.length) docChildren.push(freeLine("Full-Day Standby", freeFullDay));
  });

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: docChildren
      }
    ]
  });

  const blob = await Packer.toBlob(doc);
  const cleanSchool = (school_name || "Exam").replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_');
  const filename = `${cleanSchool}_Exam_Schedule.docx`;
  saveAs(blob, filename);
}
