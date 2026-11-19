const {
  buildSchedule,
  orderTasks,
  chunkDurations,
  effectiveEffortMinutes,
  freeWindowsWithCapacity,
} = require('../src/scheduler');

const DAY = (dow) => ({ day_of_week: dow, start_minute: 9 * 60, end_minute: 12 * 60 });

describe('chunkDurations', () => {
  it('splits effort into 90 minute sessions', () => {
    expect(chunkDurations(3)).toEqual([90, 90]);
  });

  it('keeps the remainder as a final shorter session when it is long enough', () => {
    expect(chunkDurations(2)).toEqual([90, 30]);
  });

  it('merges sub-30-minute remainders into the previous chunk', () => {
    expect(chunkDurations(1.2)).toEqual([72]);
    expect(chunkDurations(1.95)).toEqual([117]);
  });

  it('handles zero effort', () => {
    expect(chunkDurations(0)).toEqual([]);
  });
});

describe('effectiveEffortMinutes', () => {
  it('applies a difficulty factor around the neutral value 3', () => {
    expect(effectiveEffortMinutes({ estimated_hours: 2, difficulty: 3 })).toBe(120);
    expect(effectiveEffortMinutes({ estimated_hours: 2, difficulty: 5 })).toBe(144);
    expect(effectiveEffortMinutes({ estimated_hours: 2, difficulty: 1 })).toBe(96);
  });

  it('subtracts already completed minutes', () => {
    expect(effectiveEffortMinutes({ estimated_hours: 2, difficulty: 3 }, 60)).toBe(60);
  });
});

describe('orderTasks', () => {
  it('sorts by urgency, then priority, then difficulty', () => {
    const tasks = [
      { id: 1, deadline: '2030-06-10', priority: 3, difficulty: 2 },
      { id: 2, deadline: '2030-06-01', priority: 2, difficulty: 2 },
      { id: 3, deadline: '2030-06-05', priority: 1, difficulty: 4 },
      { id: 4, deadline: '2030-06-05', priority: 2, difficulty: 4 },
    ];
    expect(orderTasks(tasks, '2030-05-01').map((t) => t.id)).toEqual([2, 3, 4, 1]);
  });
});

describe('freeWindowsWithCapacity', () => {
  const slots = [DAY(1)];

  it('returns the full slot window when nothing is occupied', () => {
    const windows = freeWindowsWithCapacity(slots, '2030-06-03', new Map());
    expect(windows).toEqual([{ start: 540, end: 720 }]);
  });

  it('splits the window around an existing session', () => {
    const occupied = new Map([['2030-06-03', [{ start: 570, end: 630 }]]]);
    const windows = freeWindowsWithCapacity(slots, '2030-06-03', occupied);
    expect(windows).toEqual([
      { start: 540, end: 570 },
      { start: 630, end: 720 },
    ]);
  });

  it('ignores windows shorter than the minimum session length and misses the slot day', () => {
    const tiny = [{ day_of_week: 1, start_minute: 0, end_minute: 20 }];
    expect(freeWindowsWithCapacity(tiny, '2030-06-03', new Map())).toEqual([]);
    expect(freeWindowsWithCapacity(slots, '2030-06-04', new Map())).toEqual([]);
  });
});

describe('buildSchedule', () => {
  const slots = [
    { day_of_week: 1, start_minute: 540, end_minute: 720 },
    { day_of_week: 3, start_minute: 540, end_minute: 720 },
    { day_of_week: 5, start_minute: 540, end_minute: 720 },
  ];

  it('plans sessions before the deadline and marks stiff workloads as at risk', () => {
    const tasks = [
      { id: 1, course_id: 1, title: 'Essay', priority: 2, difficulty: 3, estimated_hours: 2, deadline: '2030-05-15', status: 'todo' },
      { id: 2, course_id: 1, title: 'Thesis', priority: 1, difficulty: 5, estimated_hours: 40, deadline: '2030-05-20', status: 'todo' },
    ];
    const result = buildSchedule({ tasks, slots, today: '2030-05-11' });

    expect(result.sessions.length).toBeGreaterThan(0);
    for (const s of result.sessions) {
      if (s.task_id === 1) {
        expect(s.scheduled_date <= '2030-05-15').toBe(true);
      }
    }
    const short = result.atRisk.find((r) => r.task_id === 2);
    expect(short).toBeDefined();
    expect(short.hoursShort).toBeGreaterThan(0);
  });

  it('does not schedule on a Sunday when no slot exists for it', () => {
    const tasks = [{ id: 1, course_id: 1, title: 'Reading', priority: 2, difficulty: 3, estimated_hours: 2, deadline: '2030-05-20', status: 'todo' }];
    const result = buildSchedule({ tasks, slots, today: '2030-05-11' });
    expect(result.sessions.every((s) => s.scheduled_date !== '2030-05-12')).toBe(true);
  });

  it('skips completed tasks and avoids double booking occupied sessions', () => {
    const tasks = [
      { id: 1, course_id: 1, title: 'Done thing', priority: 1, difficulty: 3, estimated_hours: 2, deadline: '2030-05-15', status: 'done' },
      { id: 2, course_id: 1, title: 'Open thing', priority: 2, difficulty: 2, estimated_hours: 4, deadline: '2030-05-22', status: 'todo' },
    ];
    const existing = [{ task_id: 9, scheduled_date: '2030-05-13', start_minute: 540, end_minute: 660, status: 'completed' }];
    const result = buildSchedule({ tasks, slots, existingSessions: existing, today: '2030-05-11' });
    expect(result.sessions.every((s) => s.task_id === 2)).toBe(true);

    const may13 = result.sessions.filter((s) => s.scheduled_date === '2030-05-13');
    for (const s of may13) {
      expect(s.start_minute >= 660 || s.end_minute <= 540).toBe(true);
    }
  });

  it('accounts for completed work when computing remaining effort', () => {
    const tasks = [{ id: 1, course_id: 1, title: 'Half done', priority: 2, difficulty: 3, estimated_hours: 3, deadline: '2030-05-20', status: 'todo' }];
    const existing = [{ task_id: 1, scheduled_date: '2030-05-11', start_minute: 540, end_minute: 630, status: 'completed' }];
    const result = buildSchedule({ tasks, slots, existingSessions: existing, today: '2030-05-11' });
    const plannedMinutes = result.sessions.reduce((sum, s) => sum + (s.end_minute - s.start_minute), 0);
    expect(plannedMinutes).toBe(90);
    expect(result.atRisk).toHaveLength(0);
  });

  it('does not plan anything in the past relative to the given today', () => {
    const tasks = [{ id: 1, course_id: 1, title: 'Future work', priority: 2, difficulty: 3, estimated_hours: 2, deadline: '2030-05-30', status: 'todo' }];
    const result = buildSchedule({ tasks, slots, today: '2030-05-15' });
    expect(result.sessions.every((s) => s.scheduled_date >= '2030-05-15')).toBe(true);
  });
});
