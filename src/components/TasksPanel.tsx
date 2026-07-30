import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Note } from "../types";
import {
  parseTaskDoc,
  serializeTaskDoc,
  advanceDate,
  mapTask,
  formatTime,
  formatRecurrence,
  type Task,
  type TaskDoc,
  type Priority,
  type Recurrence,
} from "../utils/taskList";
import { buildAgenda, buildDoneList, ymd, dayTitle, type IdTask } from "../utils/agenda";
import { recognize } from "../utils/naturalDate";
import { getGroups, getTasksForGroup, searchTasks, extractTags as extractHashTags, getUntaggedTasks, type Group } from "../utils/taskGroups";
import { IonIcon } from "./IonIcon";

type Props = {
  notes: Note[];
  dictionary?: string[];
  onNavigateNote: (id: string) => void;
};

export function TasksPanel({ notes, dictionary = [], onNavigateNote }: Props) {
  const [tab, setTab] = useState<"active" | "groups" | "done">("active");
  const [activeGroup, setActiveGroup] = useState<Group | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [showGroupsSearch, setShowGroupsSearch] = useState(false);
  const [showTasksSearch, setShowTasksSearch] = useState(false);
  const groupsSearchInputRef = useRef<HTMLInputElement>(null);
  const tasksSearchInputRef = useRef<HTMLInputElement>(null);
  const [hideEmpty, setHideEmpty] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addInput, setAddInput] = useState("");
  const [addPriority, setAddPriority] = useState<Priority | null>(null);
  const [schedDate, setSchedDate] = useState<{ value: string; label: string; phrase: string } | null>(null);
  const [schedTime, setSchedTime] = useState<{ value: number; label: string; phrase: string } | null>(null);
  const [schedRecurrence, setSchedRecurrence] = useState<{ value: Recurrence; label: string; phrase: string } | null>(null);
  const [focusedDay, setFocusedDay] = useState<string | null>(null);
  const [editingCid, setEditingCid] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Array<{ kind: "url"; label: string; href: string } | { kind: "note"; label: string; id: string } | { kind: "tag"; label: string }>>([]);
  const [noteSuggestions, setNoteSuggestions] = useState<Note[]>([]);
  const [noteQueryStart, setNoteQueryStart] = useState<number | null>(null);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const [showNotePicker, setShowNotePicker] = useState(false);
  const [notePickerQuery, setNotePickerQuery] = useState("");
  const [mentionSuggestions, setMentionSuggestions] = useState<string[]>([]);
  const [mentionQueryStart, setMentionQueryStart] = useState<number | null>(null);
  const [selectedMention, setSelectedMention] = useState(0);
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);
  const [tagQueryStart, setTagQueryStart] = useState<number | null>(null);
  const [selectedTag, setSelectedTag] = useState(0);
  const notePickerRef = useRef<HTMLInputElement>(null);
  const [dragCid, setDragCid] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ cid: string; position: "before" | "after" } | null>(null);
  const [dropSectionDate, setDropSectionDate] = useState<string | null>(null);
  const addInputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const [taskBody, setTaskBody] = useState("");

  const lastSaveRef = useRef(0);

  useEffect(() => {
    invoke<string>("get_tasks").then((body) => setTaskBody(body)).catch(() => {});
    const unlisten = listen("tasks-changed", () => {
      if (Date.now() - lastSaveRef.current < 2000) return;
      invoke<string>("get_tasks").then((body) => setTaskBody((prev) => body === prev ? prev : body)).catch(() => {});
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  const doc = useMemo<TaskDoc>(
    () => (taskBody ? parseTaskDoc(taskBody) : []),
    [taskBody]
  );

  const allTasks = useMemo<IdTask[]>(() => {
    let idx = 0;
    return doc.flatMap((item) =>
      item.kind === "task" ? [{ ...item.task, cid: `t${idx++}` }] : []
    );
  }, [doc]);

  const today = useMemo(() => ymd(new Date()), []);
  const [daysAhead, setDaysAhead] = useState(30);

  const allGroups = useMemo(() => getGroups(allTasks, today), [allTasks, today]);

  // Filter groups by search query (match group name or tasks within)
  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim() || tab !== "groups") return allGroups;
    const q = searchQuery.toLowerCase();
    return allGroups.filter((group) => {
      // Match group name
      if (group.name.toLowerCase().includes(q)) return true;
      // Match tasks within the group
      const groupTasks = getTasksForGroup(allTasks, group, today);
      return groupTasks.some((t) => t.text.toLowerCase().includes(q));
    });
  }, [allGroups, searchQuery, tab, allTasks, today]);

  const allExistingTags = useMemo(() => {
    const tagSet = new Set<string>();
    allTasks.forEach(task => {
      extractHashTags(task.text).forEach(tag => tagSet.add(tag));
    });
    return Array.from(tagSet).sort();
  }, [allTasks]);

  const untaggedTasks = useMemo(() => {
    const untagged = getUntaggedTasks(allTasks);
    // Filter out tasks that appear in any smart group
    let filtered = untagged.filter((task) => {
      for (const group of allGroups) {
        if (group.type === "smart") {
          const groupTasks = getTasksForGroup(allTasks, group, today);
          if (groupTasks.some((t) => t.cid === task.cid)) {
            return false; // Task is in a smart group, exclude from untagged
          }
        }
      }
      return true; // Not in any smart group, truly untagged
    });
    // Apply search filter if present
    if (searchQuery.trim() && tab === "groups") {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter((t) => t.text.toLowerCase().includes(q));
    }
    return filtered;
  }, [allTasks, allGroups, today, searchQuery, tab]);

  const activeSections = useMemo(() => {
    if (tab === "active" && !activeGroup) {
      let tasks = allTasks;
      if (searchQuery.trim()) {
        tasks = searchTasks(allTasks, searchQuery);
      }
      const all = buildAgenda(tasks, { today, daysAhead: hideEmpty ? 36500 : daysAhead });
      return hideEmpty ? all.filter((s) => s.tasks.length > 0) : all;
    } else if (activeGroup) {
      let filtered = getTasksForGroup(allTasks, activeGroup, today);
      if (searchQuery.trim()) {
        filtered = searchTasks(filtered, searchQuery);
      }
      const all = buildAgenda(filtered, { today, daysAhead: hideEmpty ? 36500 : daysAhead });
      return hideEmpty ? all.filter((s) => s.tasks.length > 0) : all;
    }
    return [];
  }, [allTasks, today, daysAhead, hideEmpty, tab, activeGroup, searchQuery]);

  const [doneSectionsLimit, setDoneSectionsLimit] = useState(30);
  const doneSections = useMemo(() => buildDoneList(allTasks, { today, maxSections: doneSectionsLimit }), [allTasks, today, doneSectionsLimit]);


  const onDraftChange = useCallback(
    (next: string, cursorPos?: number) => {
      const justCompletedWord = next.length > addInput.length && /\s$/.test(next);

      const cursor = cursorPos ?? next.length;
      const beforeCursor = next.slice(0, cursor);

      // Check for # trigger (tag autocomplete)
      const tagMatch = beforeCursor.match(/(^|\s)#([^\s]*)$/);
      if (tagMatch && allExistingTags.length > 0) {
        const query = tagMatch[2].toLowerCase();
        const hashStart = beforeCursor.length - tagMatch[2].length - 1; // position of #
        setTagQueryStart(hashStart);
        setSelectedTag(0);
        const filtered = allExistingTags
          .filter((t) => t.toLowerCase().startsWith(query))
          .slice(0, 8);
        setTagSuggestions(filtered);
        setAddInput(next);
        // Clear other suggestions if active
        if (noteQueryStart !== null) { setNoteSuggestions([]); setNoteQueryStart(null); }
        if (mentionQueryStart !== null) { setMentionSuggestions([]); setMentionQueryStart(null); }
        return;
      } else {
        if (tagQueryStart !== null) {
          setTagSuggestions([]);
          setTagQueryStart(null);
        }
      }

      // Check for @ trigger (dictionary mentions)
      const mentionMatch = beforeCursor.match(/(^|\s)@([^\s]*)$/);
      if (mentionMatch && dictionary.length > 0) {
        const query = mentionMatch[2].toLowerCase();
        const atStart = beforeCursor.length - mentionMatch[2].length - 1; // position of @
        setMentionQueryStart(atStart);
        setSelectedMention(0);
        const filtered = dictionary
          .filter((d) => d.toLowerCase().includes(query))
          .slice(0, 8);
        setMentionSuggestions(filtered);
        setAddInput(next);
        // Clear note suggestions if active
        if (noteQueryStart !== null) { setNoteSuggestions([]); setNoteQueryStart(null); }
        if (tagQueryStart !== null) { setTagSuggestions([]); setTagQueryStart(null); }
        return;
      } else {
        if (mentionQueryStart !== null) {
          setMentionSuggestions([]);
          setMentionQueryStart(null);
        }
      }

      // Check for [[ trigger (note links)
      const bracketMatch = beforeCursor.match(/\[\[([^\]]*)$/);
      if (bracketMatch) {
        const query = bracketMatch[1].toLowerCase();
        const queryStart = beforeCursor.length - bracketMatch[0].length;
        setNoteQueryStart(queryStart);
        setSelectedSuggestion(0);
        const filtered = notes
          .filter((n) => n.title.toLowerCase().includes(query) && !n.archived)
          .slice(0, 8);
        setNoteSuggestions(filtered);
        setAddInput(next);
        return;
      } else {
        if (noteQueryStart !== null) {
          setNoteSuggestions([]);
          setNoteQueryStart(null);
        }
      }

      if (!justCompletedWord) {
        setAddInput(next);
        return;
      }

      // Detect tags and lift into chips
      const liftedTagMatch = next.match(/(^|\s)(#[a-zA-Z0-9_-]+)\s$/);
      if (liftedTagMatch) {
        const tag = liftedTagMatch[2].slice(1); // Remove the # prefix
        const stripped = next.slice(0, liftedTagMatch.index! + liftedTagMatch[1].length).trimEnd();
        setAddInput(stripped ? stripped + " " : "");
        setAttachments((prev) => [...prev, { kind: "tag", label: tag }]);
        return;
      }

      // Detect pasted/typed URLs and lift into attachment chips
      const urlMatch = next.match(/(^|\s)((?:https?:\/\/|www\.)\S+)\s$/);
      if (urlMatch) {
        const raw = urlMatch[2];
        const href = raw.startsWith("http") ? raw : `https://${raw}`;
        const host = href.match(/^https?:\/\/([^/?#]+)/i)?.[1]?.replace(/^www\./i, "") ?? raw;
        const stripped = next.slice(0, urlMatch.index! + urlMatch[1].length).trimEnd();
        setAddInput(stripped ? stripped + " " : "");
        setAttachments((prev) => [...prev, { kind: "url", label: host, href }]);
        return;
      }

      // Bare year (20XX) upgrades an existing date chip
      const bareYear = next.trim().match(/(?:^|\s)(20\d{2})\s*$/);
      if (bareYear && schedDate) {
        const year = Number(bareYear[1]);
        const parts = schedDate.value.split("-");
        const refined = `${year}-${parts[1]}-${parts[2]}`;
        setSchedDate({ value: refined, label: dayTitle(refined, today), phrase: `${schedDate.phrase} ${year}` });
        const start = next.lastIndexOf(bareYear[1]);
        const stripped = (next.slice(0, start) + next.slice(start + bareYear[1].length)).replace(/\s+/g, " ").trim();
        setAddInput(stripped ? stripped + " " : "");
        return;
      }

      const r = recognize(next, undefined, { allowBareTime: true });
      let lifted = false;
      const allSpans: Array<[number, number]> = [];

      if (r.date && r.dateSpans.length > 0 && !schedDate) {
        const phrase = r.dateSpans.map(([s, e]) => next.slice(s, e)).join(" ");
        setSchedDate({ value: r.date, label: dayTitle(r.date, today), phrase });
        allSpans.push(...r.dateSpans);
        lifted = true;
      }

      if (r.time !== null && r.timeSpans.length > 0 && !schedTime) {
        const tPhrase = r.timeSpans.map(([s, e]) => next.slice(s, e)).join(" ");
        setSchedTime({ value: r.time, label: formatTime(r.time), phrase: tPhrase });
        allSpans.push(...r.timeSpans);
        lifted = true;
      }

      if (r.recurrence && r.recurrenceSpans.length > 0 && !schedRecurrence) {
        const rPhrase = r.recurrenceSpans.map(([s, e]) => next.slice(s, e)).join(" ");
        setSchedRecurrence({ value: r.recurrence, label: rPhrase, phrase: rPhrase });
        allSpans.push(...r.recurrenceSpans);
        lifted = true;
        if (r.date && !schedDate && r.dateSpans.length === 0) {
          setSchedDate({ value: r.date, label: dayTitle(r.date, today), phrase: "" });
        }
      }

      if (lifted) {
        let stripped = next;
        for (const [s, e] of allSpans.sort((a, b) => b[0] - a[0])) {
          stripped = stripped.slice(0, s) + stripped.slice(e);
        }
        setAddInput(stripped.replace(/\s+/g, " ").trim() + " ");
      } else {
        setAddInput(next);
      }
    },
    [addInput, schedDate, schedTime, schedRecurrence, today, notes, dictionary, allExistingTags, noteQueryStart, mentionQueryStart, tagQueryStart]
  );

  const insertTag = useCallback(
    (tag: string) => {
      if (tagQueryStart === null) return;
      const before = addInput.slice(0, tagQueryStart);
      const afterMatch = addInput.slice(tagQueryStart).match(/^#[^\s]*/);
      const after = afterMatch ? addInput.slice(tagQueryStart + afterMatch[0].length) : addInput.slice(tagQueryStart);
      setAddInput(before + `#${tag}` + " " + after.trimStart());
      setTagSuggestions([]);
      setTagQueryStart(null);
      addInputRef.current?.focus();
    },
    [addInput, tagQueryStart]
  );

  const insertMention = useCallback(
    (mention: string) => {
      if (mentionQueryStart === null) return;
      const before = addInput.slice(0, mentionQueryStart);
      const afterMatch = addInput.slice(mentionQueryStart).match(/^@[^\s]*/);
      const after = afterMatch ? addInput.slice(mentionQueryStart + afterMatch[0].length) : addInput.slice(mentionQueryStart);
      setAddInput(before + `@${mention}` + " " + after.trimStart());
      setMentionSuggestions([]);
      setMentionQueryStart(null);
      addInputRef.current?.focus();
    },
    [addInput, mentionQueryStart]
  );

  const insertNoteLink = useCallback(
    (note: Note) => {
      if (noteQueryStart !== null) {
        const before = addInput.slice(0, noteQueryStart);
        const afterBracket = addInput.slice(noteQueryStart);
        const queryMatch = afterBracket.match(/\[\[([^\]]*)$/);
        const after = queryMatch
          ? addInput.slice(noteQueryStart + queryMatch[0].length)
          : "";
        setAddInput((before + after).replace(/\s+/g, " ").trimEnd() + (before + after ? " " : ""));
      }
      setAttachments((prev) => [...prev, { kind: "note", label: note.title, id: note.id }]);
      setNoteSuggestions([]);
      setNoteQueryStart(null);
      addInputRef.current?.focus();
    },
    [addInput, noteQueryStart]
  );

  const insertNoteLinkFromPicker = useCallback(
    (note: Note) => {
      setAttachments((prev) => [...prev, { kind: "note", label: note.title, id: note.id }]);
      setShowNotePicker(false);
      setNotePickerQuery("");
      addInputRef.current?.focus();
    },
    []
  );

  const removeAttachment = useCallback(
    (index: number) => {
      setAttachments((prev) => prev.filter((_, i) => i !== index));
    },
    []
  );

  const notePickerResults = useMemo(
    () => notes
      .filter((n) => n.title.toLowerCase().includes(notePickerQuery.toLowerCase()) && !n.archived)
      .slice(0, 8),
    [notes, notePickerQuery]
  );

  const dismissDate = useCallback(() => {
    const words = [schedDate?.phrase, schedTime?.phrase].filter(Boolean).join(" ");
    setSchedDate(null);
    setSchedTime(null);
    setAddInput((d) => (words ? `${d}${words} ` : d));
  }, [schedDate, schedTime]);

  const dismissTime = useCallback(() => {
    const w = schedTime?.phrase;
    setSchedTime(null);
    setAddInput((d) => (w ? `${d}${w} ` : d));
  }, [schedTime]);

  const dismissRecurrence = useCallback(() => {
    const w = schedRecurrence?.phrase;
    setSchedRecurrence(null);
    setAddInput((d) => (w ? `${d}${w} ` : d));
  }, [schedRecurrence]);

  const persistDoc = useCallback(
    (newDoc: TaskDoc) => {
      const body = serializeTaskDoc(newDoc);
      setTaskBody(body);
      lastSaveRef.current = Date.now();
      invoke("save_tasks", { content: body }).catch(() => {});
    },
    []
  );

  const toggleDone = useCallback(
    (cid: string) => {
      const newDoc = mapTask(doc, cid, (task) => {
        if (task.recurrence && task.date && !task.done) {
          return { ...task, date: advanceDate(task.date, task.recurrence) };
        }
        return { ...task, done: !task.done };
      });
      persistDoc(newDoc);
    },
    [doc, persistDoc]
  );

  const deleteTask = useCallback(
    (cid: string) => persistDoc(mapTask(doc, cid, () => null)),
    [doc, persistDoc]
  );

  const editTask = useCallback(
    (cid: string, updates: Partial<Task>) => {
      persistDoc(mapTask(doc, cid, (task) => ({ ...task, ...updates })));
    },
    [doc, persistDoc]
  );

  const openEditModal = useCallback(
    (cid: string) => {
      const task = allTasks.find((t) => t.cid === cid);
      if (!task) return;
      // Parse existing attachments out of text
      const { title, chips } = extractChips(task.text);
      const tags = extractHashTags(task.text);
      setEditingCid(cid);
      setAddInput(title);
      setAddPriority(task.priority);
      setSchedDate(task.date ? { value: task.date, label: dayTitle(task.date, today), phrase: task.date } : null);
      setSchedTime(task.time !== null ? { value: task.time, label: formatTime(task.time), phrase: formatTime(task.time) } : null);
      setSchedRecurrence(task.recurrence ? { value: task.recurrence, label: formatRecurrence(task.recurrence), phrase: formatRecurrence(task.recurrence) } : null);
      setAttachments([
        ...chips.map((c) => {
          if (c.kind === "note") return { kind: "note" as const, label: c.label, id: c.id };
          if (c.kind === "url") return { kind: "url" as const, label: c.label, href: c.href };
          return { kind: "tag" as const, label: c.label };
        }),
        ...tags.map((tag) => ({ kind: "tag" as const, label: tag }))
      ]);
      setNoteSuggestions([]);
      setNoteQueryStart(null);
      setMentionSuggestions([]);
      setMentionQueryStart(null);
      setShowNotePicker(false);
      setShowAddModal(true);
    },
    [allTasks, today]
  );

  const reorderTask = useCallback(
    (fromCid: string, toCid: string, position: "before" | "after", targetDate: string | null) => {
      let idx = 0;
      let fromIdx = -1;
      let toIdx = -1;
      for (let i = 0; i < doc.length; i++) {
        if (doc[i].kind === "task") {
          const cid = `t${idx++}`;
          if (cid === fromCid) fromIdx = i;
          if (cid === toCid) toIdx = i;
        }
      }
      if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;

      const item = doc[fromIdx];
      if (item.kind !== "task") return;

      const updatedItem = targetDate
        ? { kind: "task" as const, task: { ...item.task, date: targetDate === today ? null : targetDate } }
        : item;

      const newDoc = [...doc];
      newDoc.splice(fromIdx, 1);
      const adjustedTo = toIdx > fromIdx ? toIdx - 1 : toIdx;
      const insertAt = position === "after" ? adjustedTo + 1 : adjustedTo;
      newDoc.splice(insertAt, 0, updatedItem);
      persistDoc(newDoc);
    },
    [doc, persistDoc, today]
  );

  const moveToSection = useCallback(
    (fromCid: string, sectionDate: string) => {
      let idx = 0;
      let fromIdx = -1;
      for (let i = 0; i < doc.length; i++) {
        if (doc[i].kind === "task") {
          if (`t${idx++}` === fromCid) { fromIdx = i; break; }
        }
      }
      if (fromIdx === -1) return;
      const item = doc[fromIdx];
      if (item.kind !== "task") return;

      const newDate = sectionDate === today ? null : sectionDate;
      const updatedItem = { kind: "task" as const, task: { ...item.task, date: newDate } };

      const newDoc = [...doc];
      newDoc.splice(fromIdx, 1);
      newDoc.push(updatedItem);
      persistDoc(newDoc);
    },
    [doc, today, persistDoc]
  );

  const handleDragStart = useCallback((e: React.DragEvent, cid: string) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", cid);
    requestAnimationFrame(() => setDragCid(cid));
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, cid: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const rect = e.currentTarget.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const pos = e.clientY < midY ? "before" : "after";
    setDropTarget({ cid, position: pos });
    setDropSectionDate(null);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDropTarget(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, toCid: string, sectionDate: string) => {
      e.preventDefault();
      const fromCid = e.dataTransfer.getData("text/plain");
      if (!fromCid || fromCid === toCid) {
        setDragCid(null);
        setDropTarget(null);
        setDropSectionDate(null);
        return;
      }
      const position = dropTarget?.cid === toCid ? dropTarget.position : "after";
      reorderTask(fromCid, toCid, position, sectionDate);
      setDragCid(null);
      setDropTarget(null);
      setDropSectionDate(null);
    },
    [dropTarget, reorderTask]
  );

  const handleDragEnd = useCallback(() => {
    setDragCid(null);
    setDropTarget(null);
    setDropSectionDate(null);
  }, []);

  const handleSectionDragOver = useCallback((e: React.DragEvent, date: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropSectionDate(date);
    setDropTarget(null);
  }, []);

  const handleSectionDragLeave = useCallback(() => {
    setDropSectionDate(null);
  }, []);

  const handleSectionDrop = useCallback(
    (e: React.DragEvent, sectionDate: string) => {
      e.preventDefault();
      const fromCid = e.dataTransfer.getData("text/plain");
      if (!fromCid) { setDragCid(null); setDropSectionDate(null); return; }
      moveToSection(fromCid, sectionDate);
      setDragCid(null);
      setDropSectionDate(null);
    },
    [moveToSection]
  );

  const handleSubmit = useCallback(async () => {
    const rawText = addInput.trim();
    if (!rawText && attachments.length === 0) return;

    const linkParts = attachments.map((a) => {
      if (a.kind === "url") return `[${a.label}](${a.href})`;
      if (a.kind === "note") return `[${a.label}](scratch://${a.id})`;
      return `#${a.label}`;
    });
    const text = [rawText, ...linkParts].filter(Boolean).join(" ");

    const date = schedDate?.value ?? focusedDay ?? null;
    const time = schedTime?.value ?? null;
    const recurrence = schedRecurrence?.value ?? null;

    if (editingCid) {
      editTask(editingCid, { text, date, time, priority: addPriority, recurrence });
    } else {
      const newTask: Task = { text, date, time, priority: addPriority, recurrence, done: false };
      persistDoc([...doc, { kind: "task", task: newTask }]);
    }

    setAddInput("");
    setAddPriority(null);
    setSchedDate(null);
    setSchedTime(null);
    setSchedRecurrence(null);
    setAttachments([]);
    setEditingCid(null);
    setShowAddModal(false);
  }, [addInput, addPriority, attachments, schedDate, schedTime, schedRecurrence, focusedDay, editingCid, editTask, doc, persistDoc]);

  const closeModal = useCallback(() => {
    setShowAddModal(false);
    setEditingCid(null);
  }, []);

  const sections = (tab === "active" || activeGroup) ? activeSections : doneSections;
  const isEmpty = sections.every((s) => s.tasks.length === 0);

  const toggleGroupExpanded = useCallback((groupId: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }, []);

  const toggleExpandAll = useCallback(() => {
    const allGroupIds = filteredGroups.map(g => g.id);
    const allExpanded = allGroupIds.every(id => expandedGroups.has(id));

    if (allExpanded) {
      // Collapse all
      setExpandedGroups(new Set());
    } else {
      // Expand all
      setExpandedGroups(new Set(allGroupIds));
    }
  }, [filteredGroups, expandedGroups]);

  const clearFilter = useCallback(() => {
    setActiveGroup(null);
  }, []);

  const handleScroll = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    const listTop = list.getBoundingClientRect().top;
    let closest: string | null = null;
    for (const [date, el] of sectionRefs.current) {
      const rect = el.getBoundingClientRect();
      if (rect.top <= listTop) closest = date;
    }
    if (closest) setFocusedDay(closest);

    if (list.scrollTop + list.clientHeight >= list.scrollHeight - 200) {
      if (tab === "active" && !hideEmpty) setDaysAhead((prev) => prev + 30);
      else if (tab === "done") setDoneSectionsLimit((prev) => prev + 30);
    }
  }, [tab, hideEmpty]);

  useEffect(() => {
    if (sections.length > 0 && !focusedDay) {
      setFocusedDay(sections[0].date);
    }
  }, [sections, focusedDay]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f" && !e.shiftKey) {
        const target = e.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
        e.preventDefault();

        if (tab === "groups") {
          setShowGroupsSearch((prev) => {
            const next = !prev;
            if (next) {
              setTimeout(() => groupsSearchInputRef.current?.focus(), 50);
            }
            return next;
          });
        } else if (tab === "active" || activeGroup) {
          setShowTasksSearch((prev) => {
            const next = !prev;
            if (next) {
              setTimeout(() => tasksSearchInputRef.current?.focus(), 50);
            }
            return next;
          });
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tab, activeGroup]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "q" && !e.metaKey && !e.ctrlKey && !e.altKey && !showAddModal) {
        const target = e.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
        e.preventDefault();
        setAddInput("");
        setAddPriority(null);
        setSchedDate(null);
        setSchedTime(null);
        setSchedRecurrence(null);
        setAttachments([]);
        setNoteSuggestions([]);
        setNoteQueryStart(null);
        setShowNotePicker(false);
        setShowAddModal(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showAddModal]);

  useEffect(() => {
    if (showAddModal && addInputRef.current) {
      const el = addInputRef.current;
      el.style.height = "auto";
      el.style.height = el.scrollHeight + "px";
      // Position cursor at end when editing
      setTimeout(() => {
        if (addInputRef.current) {
          const length = addInputRef.current.value.length;
          addInputRef.current.setSelectionRange(length, length);
          addInputRef.current.focus();
        }
      }, 0);
    }
  }, [showAddModal]);

  const focusLabel = useMemo(
    () => focusedDay ? dayTitle(focusedDay, today) : "",
    [focusedDay, today]
  );

  const focusCount = useMemo(
    () => focusedDay ? (sections.find((s) => s.date === focusedDay)?.tasks.length ?? 0) : 0,
    [focusedDay, sections]
  );

  return (
    <div className="tasks-panel">
      <div className="tasks-focus-bar">
        <div className="tasks-focus-left">
          <div className="tasks-focus-accent" />
          <div className="tasks-focus-text">
            <span className="tasks-focus-eyebrow">
              {activeGroup ? "FILTERED BY" : tab === "groups" ? "TAG" : tab === "done" ? "DONE" : "IN FOCUS"}
            </span>
            <span className="tasks-focus-day">
              {activeGroup ? (
                <>
                  {activeGroup.type === "smart" && <span style={{ marginRight: "6px" }}><IonIcon name={activeGroup.icon} size={16} /></span>}
                  {activeGroup.name}
                  <button
                    className="tasks-clear-filter"
                    onClick={clearFilter}
                    style={{
                      marginLeft: "8px",
                      padding: "2px 8px",
                      fontSize: "11px",
                      background: "var(--bg-secondary)",
                      border: "1px solid var(--border)",
                      borderRadius: "4px",
                      cursor: "pointer",
                      color: "var(--text-secondary)",
                    }}
                  >
                    Clear
                  </button>
                </>
              ) : tab === "groups" ? (
                "Groups"
              ) : tab === "done" ? (
                "Tasks"
              ) : (
                <>
                  {focusLabel || "Today"}
                  {focusCount > 0 && <span className="tasks-focus-count">{focusCount}</span>}
                </>
              )}
            </span>
          </div>
        </div>
        <div className="tasks-tabs">
          <button
            className={`tasks-tab ${tab === "active" && !activeGroup ? "active" : ""}`}
            onClick={() => { setTab("active"); setActiveGroup(null); setSearchQuery(""); }}
          >
            Tasks
          </button>
          <button
            className={`tasks-tab ${tab === "groups" ? "active" : ""}`}
            onClick={() => { setTab("groups"); setActiveGroup(null); setSearchQuery(""); }}
          >
            Tags
          </button>
          <button
            className={`tasks-tab ${tab === "done" ? "active" : ""}`}
            onClick={() => { setTab("done"); setActiveGroup(null); setSearchQuery(""); }}
          >
            Done
          </button>
          <button
            className={`tasks-tab-toggle ${(tab === "active" && hideEmpty) || (tab === "groups" && filteredGroups.every(g => expandedGroups.has(g.id))) ? "active" : ""} ${tab === "done" ? "disabled" : ""}`}
            onClick={() => {
              if (tab === "groups") {
                toggleExpandAll();
              } else if (tab === "active") {
                setHideEmpty((v) => !v);
              }
            }}
            title={tab === "groups" ? (filteredGroups.every(g => expandedGroups.has(g.id)) ? "Collapse all groups" : "Expand all groups") : "Hide empty days"}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {tab === "groups" ? (
                filteredGroups.every(g => expandedGroups.has(g.id)) ? (
                  <polyline points="6 9 12 15 18 9" />
                ) : (
                  <polyline points="9 6 15 12 9 18" />
                )
              ) : (
                hideEmpty ? (
                  <polyline points="9 6 15 12 9 18" />
                ) : (
                  <polyline points="6 9 12 15 18 9" />
                )
              )}
            </svg>
          </button>
        </div>
      </div>

      {showAddModal && (
        <div className="tasks-modal-overlay" onClick={closeModal}>
          <div className="tasks-modal" onClick={(e) => e.stopPropagation()}>
            <div className="tasks-modal-header">
              <div className="tasks-modal-title-row">
                <span className="tasks-modal-title">
                  {editingCid ? "Edit" : schedDate ? "Add to" : `Add to ${focusLabel || "Today"}`}
                </span>
                {schedDate && (
                  <button className="tasks-chip tasks-chip-dismiss" onClick={dismissDate}>
                    {schedDate.label} <span className="tasks-chip-x">×</span>
                  </button>
                )}
                {schedTime && (
                  <button className="tasks-chip tasks-chip-dismiss" onClick={dismissTime}>
                    {schedTime.label} <span className="tasks-chip-x">×</span>
                  </button>
                )}
                {schedRecurrence && (
                  <button className="tasks-chip tasks-chip-dismiss tasks-chip-recurrence" onClick={dismissRecurrence}>
                    {schedRecurrence.label} <span className="tasks-chip-x">×</span>
                  </button>
                )}
              </div>
              <button className="tasks-modal-close" onClick={closeModal}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            {attachments.length > 0 && (
              <div className="tasks-modal-attachments">
                {attachments.map((a, i) => (
                  <button key={i} className={`tasks-chip tasks-chip-dismiss tasks-chip-${a.kind}`} onClick={() => removeAttachment(i)}>
                    {a.kind === "note" ? `[[${a.label}]]` : a.kind === "tag" ? `#${a.label}` : a.label}
                    <span className="tasks-chip-x">×</span>
                  </button>
                ))}
              </div>
            )}
            <div className="tasks-modal-input-wrapper">
              <textarea
                ref={addInputRef}
                className="tasks-modal-input"
                placeholder="e.g. Call dentist tomorrow 9am"
                value={addInput}
                rows={1}
                onChange={(e) => {
                  onDraftChange(e.target.value, e.target.selectionStart ?? undefined);
                  e.target.style.height = "auto";
                  e.target.style.height = e.target.scrollHeight + "px";
                }}
                onKeyDown={(e) => {
                  if (tagSuggestions.length > 0) {
                    if (e.key === "ArrowDown") { e.preventDefault(); setSelectedTag((s) => Math.min(s + 1, tagSuggestions.length - 1)); return; }
                    if (e.key === "ArrowUp") { e.preventDefault(); setSelectedTag((s) => Math.max(s - 1, 0)); return; }
                    if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); insertTag(tagSuggestions[selectedTag]); return; }
                    if (e.key === "Escape") { e.preventDefault(); setTagSuggestions([]); setTagQueryStart(null); return; }
                  }
                  if (mentionSuggestions.length > 0) {
                    if (e.key === "ArrowDown") { e.preventDefault(); setSelectedMention((s) => Math.min(s + 1, mentionSuggestions.length - 1)); return; }
                    if (e.key === "ArrowUp") { e.preventDefault(); setSelectedMention((s) => Math.max(s - 1, 0)); return; }
                    if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); insertMention(mentionSuggestions[selectedMention]); return; }
                    if (e.key === "Escape") { e.preventDefault(); setMentionSuggestions([]); setMentionQueryStart(null); return; }
                  }
                  if (noteSuggestions.length > 0) {
                    if (e.key === "ArrowDown") { e.preventDefault(); setSelectedSuggestion((s) => Math.min(s + 1, noteSuggestions.length - 1)); return; }
                    if (e.key === "ArrowUp") { e.preventDefault(); setSelectedSuggestion((s) => Math.max(s - 1, 0)); return; }
                    if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); insertNoteLink(noteSuggestions[selectedSuggestion]); return; }
                    if (e.key === "Escape") { e.preventDefault(); setNoteSuggestions([]); setNoteQueryStart(null); return; }
                  }
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
                  if (e.key === "Escape") closeModal();
                }}
                autoFocus
              />
              {tagSuggestions.length > 0 && (
                <div className="tasks-note-suggestions">
                  {tagSuggestions.map((tag, i) => (
                    <button
                      key={tag}
                      className={`tasks-note-suggestion ${i === selectedTag ? "selected" : ""}`}
                      onMouseDown={(e) => { e.preventDefault(); insertTag(tag); }}
                    >
                      <span className="tasks-note-suggestion-title">#{tag}</span>
                    </button>
                  ))}
                </div>
              )}
              {mentionSuggestions.length > 0 && (
                <div className="tasks-note-suggestions">
                  {mentionSuggestions.map((mention, i) => (
                    <button
                      key={mention}
                      className={`tasks-note-suggestion ${i === selectedMention ? "selected" : ""}`}
                      onMouseDown={(e) => { e.preventDefault(); insertMention(mention); }}
                    >
                      <span className="tasks-note-suggestion-title">@{mention}</span>
                    </button>
                  ))}
                </div>
              )}
              {noteSuggestions.length > 0 && (
                <div className="tasks-note-suggestions">
                  {noteSuggestions.map((note, i) => (
                    <button
                      key={note.id}
                      className={`tasks-note-suggestion ${i === selectedSuggestion ? "selected" : ""}`}
                      onMouseDown={(e) => { e.preventDefault(); insertNoteLink(note); }}
                    >
                      <span className="tasks-note-suggestion-title">{note.title}</span>
                      {note.codex && <span className="tasks-note-suggestion-codex">{note.codex}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="tasks-modal-actions">
              <div className="tasks-modal-actions-left">
                <button
                  className={`tasks-modal-priority ${addPriority ? `tasks-modal-priority-${addPriority}` : ""}`}
                  onClick={() => {
                    const cycle: Array<Priority | null> = ["high", "med", "low", null];
                    const idx = cycle.indexOf(addPriority);
                    setAddPriority(cycle[(idx + 1) % cycle.length]);
                  }}
                >
                  {addPriority ? `Priority: ${addPriority}` : "Priority"}
                </button>
                <div className="tasks-note-picker-wrapper">
                  <button
                    className="tasks-modal-link-btn"
                    onClick={() => { setShowNotePicker((v) => !v); setNotePickerQuery(""); }}
                    title="Link a note"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                    </svg>
                    Note
                  </button>
                  {showNotePicker && (
                    <div className="tasks-note-picker">
                      <input
                        ref={notePickerRef}
                        className="tasks-note-picker-input"
                        type="text"
                        placeholder="Search notes..."
                        value={notePickerQuery}
                        onChange={(e) => setNotePickerQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") { setShowNotePicker(false); addInputRef.current?.focus(); }
                          if (e.key === "Enter" && notePickerResults.length > 0) { e.preventDefault(); insertNoteLinkFromPicker(notePickerResults[0]); }
                        }}
                        autoFocus
                      />
                      <div className="tasks-note-picker-results">
                        {notePickerResults.map((note) => (
                          <button
                            key={note.id}
                            className="tasks-note-suggestion"
                            onMouseDown={(e) => { e.preventDefault(); insertNoteLinkFromPicker(note); }}
                          >
                            <span className="tasks-note-suggestion-title">{note.title}</span>
                            {note.codex && <span className="tasks-note-suggestion-codex">{note.codex}</span>}
                          </button>
                        ))}
                        {notePickerResults.length === 0 && (
                          <div className="tasks-note-picker-empty">No notes found</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <button className="tasks-modal-submit" onClick={handleSubmit} disabled={!addInput.trim() && attachments.length === 0}>
                {editingCid ? "Save" : "Add"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="tasks-list" ref={listRef} onScroll={handleScroll}>
        {(tab === "active" || activeGroup) && showTasksSearch && (
          <div className="tasks-groups-search-dropdown">
            <input
              ref={tasksSearchInputRef}
              type="text"
              className="tasks-groups-search-input"
              placeholder="Search tasks..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setSearchQuery("");
                  setShowTasksSearch(false);
                  e.currentTarget.blur();
                }
              }}
              onBlur={() => {
                if (!searchQuery.trim()) {
                  setShowTasksSearch(false);
                }
              }}
            />
            {searchQuery.trim() && (
              <button
                className="tasks-groups-search-clear"
                onClick={() => setSearchQuery("")}
                onMouseDown={(e) => e.preventDefault()}
                title="Clear search"
              >
                ×
              </button>
            )}
          </div>
        )}
        {tab === "groups" && (
          <div className="tasks-groups-view">
            {showGroupsSearch && (
              <div className="tasks-groups-search-dropdown">
                <input
                  ref={groupsSearchInputRef}
                  type="text"
                  className="tasks-groups-search-input"
                  placeholder="Search groups and tasks..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setSearchQuery("");
                      setShowGroupsSearch(false);
                      e.currentTarget.blur();
                    }
                  }}
                  onBlur={() => {
                    if (!searchQuery.trim()) {
                      setShowGroupsSearch(false);
                    }
                  }}
                />
                {searchQuery.trim() && (
                  <button
                    className="tasks-groups-search-clear"
                    onClick={() => setSearchQuery("")}
                    onMouseDown={(e) => e.preventDefault()}
                    title="Clear search"
                  >
                    ×
                  </button>
                )}
              </div>
            )}
            <div className="tasks-groups-list">
              {filteredGroups.length === 0 && searchQuery.trim() ? (
                <div className="tasks-empty">No groups match "{searchQuery}"</div>
              ) : filteredGroups.length === 0 ? (
                  <div className="tasks-empty">
                    No groups yet. Add tags to your tasks (e.g., #work, #personal) to organize them.
                  </div>
                ) : (
                  filteredGroups.map((group) => {
                    const isExpanded = expandedGroups.has(group.id);
                    const groupTasks = getTasksForGroup(allTasks, group, today);
                    const count = groupTasks.length;
                    return (
                      <div key={group.id} className="tasks-groups-item-container">
                        <button
                          className="tasks-groups-item"
                          onClick={() => toggleGroupExpanded(group.id)}
                        >
                          <div className="tasks-groups-item-left">
                            {group.type === "smart" && (
                              <span className="tasks-groups-item-icon"><IonIcon name={group.icon} size={18} /></span>
                            )}
                            <span className="tasks-groups-item-name">{group.name}</span>
                          </div>
                          <span className="tasks-groups-item-count">{count}</span>
                          <span className="tasks-groups-item-chevron">
                            {isExpanded ? "▼" : "▶"}
                          </span>
                        </button>
                        {isExpanded && (
                          <div className="tasks-groups-expanded-tasks">
                            {groupTasks.map((task) => (
                              <TaskRow
                                key={task.cid}
                                task={task}
                                today={today}
                                compact={false}
                                onToggle={() => toggleDone(task.cid)}
                                onDelete={() => deleteTask(task.cid)}
                                onEdit={() => openEditModal(task.cid)}
                                onNavigateNote={onNavigateNote}
                                isDragging={false}
                                dropIndicator={null}
                                onDragStart={() => {}}
                                onDragOver={() => {}}
                                onDragLeave={() => {}}
                                onDrop={() => {}}
                                onDragEnd={() => {}}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
            </div>

            {/* Untagged tasks section */}
            {untaggedTasks.length > 0 && (
              <div className="tasks-groups-untagged">
                <div className="tasks-groups-untagged-header">
                  Untagged ({untaggedTasks.length})
                </div>
                {untaggedTasks.map((task) => (
                  <TaskRow
                    key={task.cid}
                    task={task}
                    today={today}
                    compact={false}
                    onToggle={() => toggleDone(task.cid)}
                    onDelete={() => deleteTask(task.cid)}
                    onEdit={() => openEditModal(task.cid)}
                    onNavigateNote={onNavigateNote}
                    isDragging={false}
                    dropIndicator={null}
                    onDragStart={() => {}}
                    onDragOver={() => {}}
                    onDragLeave={() => {}}
                    onDrop={() => {}}
                    onDragEnd={() => {}}
                  />
                ))}
              </div>
            )}
          </div>
        )}
        {isEmpty && tab === "active" && !activeGroup && (
          <div className="tasks-empty">No tasks yet. Press <strong>+ New</strong> or <strong>Q</strong> to add one.</div>
        )}
        {isEmpty && tab === "active" && activeGroup && (
          <div className="tasks-empty">No tasks in this group.</div>
        )}
        {isEmpty && tab === "done" && (
          <div className="tasks-empty">No completed tasks.</div>
        )}
        {tab !== "groups" && sections.map((section) =>
          section.tasks.length === 0 && tab === "done" ? null : (
            <div key={section.date} className="tasks-section" ref={(el) => { if (el) sectionRefs.current.set(section.date, el); }}>
              <div
                className={`tasks-section-header ${dropSectionDate === section.date ? "tasks-section-header-drop" : ""}`}
                onDragOver={(e) => handleSectionDragOver(e, section.date)}
                onDragLeave={handleSectionDragLeave}
                onDrop={(e) => handleSectionDrop(e, section.date)}
              >
                <span className="tasks-section-title">{section.title}</span>
                {section.tasks.length > 0 && (
                  <span className="tasks-section-count">{section.tasks.length}</span>
                )}
              </div>
              {section.tasks.map((task) => (
                <TaskRow
                  key={task.cid}
                  task={task}
                  today={today}
                  compact={tab === "done"}
                  onToggle={() => toggleDone(task.cid)}
                  onDelete={() => deleteTask(task.cid)}
                  onEdit={() => openEditModal(task.cid)}
                  onNavigateNote={onNavigateNote}
                  isDragging={dragCid === task.cid}
                  dropIndicator={dropTarget?.cid === task.cid ? dropTarget.position : null}
                  onDragStart={(e) => handleDragStart(e, task.cid)}
                  onDragOver={(e) => handleDragOver(e, task.cid)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, task.cid, section.date)}
                  onDragEnd={handleDragEnd}
                />
              ))}
            </div>
          )
        )}
      </div>

      {(tab === "active" || activeGroup) && (
        <button className="tasks-fab" onClick={() => { setAddInput(""); setAddPriority(null); setSchedDate(null); setSchedTime(null); setSchedRecurrence(null); setAttachments([]); setNoteSuggestions([]); setNoteQueryStart(null); setShowNotePicker(false); setShowAddModal(true); }}>
          + New <span className="tasks-fab-hint">Q</span>
        </button>
      )}
    </div>
  );
}

function TaskRow({
  task,
  today,
  compact,
  onToggle,
  onDelete,
  onEdit,
  onNavigateNote,
  isDragging,
  dropIndicator,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
}: {
  task: IdTask;
  today: string;
  compact?: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onNavigateNote: (id: string) => void;
  isDragging: boolean;
  dropIndicator: "before" | "after" | null;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}) {
  const { title, chips } = useMemo(() => extractChips(task.text), [task.text]);

  return (
    <div
      className={`task-row ${task.done ? "task-done" : ""} ${compact ? "task-done-compact" : ""} ${isDragging ? "task-dragging" : ""} ${dropIndicator ? `task-drop-${dropIndicator}` : ""}`}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onDoubleClick={onEdit}
    >
      <button className="task-checkbox" onClick={onToggle} aria-label={task.done ? "Mark incomplete" : "Mark complete"}>
        {task.done ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="3" fill="var(--accent)" stroke="var(--accent)" />
            <polyline points="9 11 12 14 16 9" stroke="var(--bg-primary)" strokeWidth="2.5" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="3" />
          </svg>
        )}
      </button>
      <div className="task-content">
        <div className="task-title-row">
          <span className="task-title">{title}</span>
          <div className="task-title-right">
            {task.priority && (
              <span className={`task-priority task-priority-${task.priority}`}>
                {task.priority}
              </span>
            )}
            {task.time !== null && (
              <span className="task-time">
                {formatTime(task.time)}
              </span>
            )}
          </div>
        </div>
        <div className="task-meta">
          {!task.done && task.date !== null && task.date < today && (
            <span className="task-overdue">overdue</span>
          )}
          {task.recurrence && (
            <span className="task-recurrence">
              {formatRecurrence(task.recurrence)}
            </span>
          )}
          {chips.map((chip, i) => {
            if (chip.kind === "note") {
              return (
                <button key={i} className="task-chip task-chip-note" onClick={() => onNavigateNote(chip.id)}>
                  {chip.label}
                </button>
              );
            }
            if (chip.kind === "url") {
              return (
                <a key={i} className="task-chip task-chip-url" href={chip.href} target="_blank" rel="noopener noreferrer">
                  {chip.label}
                </a>
              );
            }
            return (
              <span key={i} className="task-chip task-chip-tag">
                #{chip.label}
              </span>
            );
          })}
        </div>
      </div>
      <div className="task-actions">
        {compact && (
          <button className="task-undo" onClick={onToggle} title="Undo">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="1 4 1 10 7 10" />
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
            </svg>
          </button>
        )}
        <button className="task-edit" onClick={onEdit} title="Edit task">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        </button>
        <button className="task-delete" onClick={onDelete} title="Delete task">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  );
}

type Chip =
  | { kind: "note"; label: string; id: string }
  | { kind: "url"; label: string; href: string }
  | { kind: "tag"; label: string };

const MD_LINK_RE = /\[([^\]]*)\]\(([^)\s]+)\)/g;
const BARE_URL_RE = /https?:\/\/[^\s]+/g;
const TAG_RE = /#([a-zA-Z0-9_-]+)/g;

function extractChips(text: string): { title: string; chips: Chip[] } {
  const chips: Chip[] = [];
  type Hit = { start: number; end: number; chip?: Chip; raw?: string; isTag?: boolean };
  const hits: Hit[] = [];

  MD_LINK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MD_LINK_RE.exec(text)) !== null) {
    const [whole, label, target] = m;
    const noteMatch = target.match(/^scratch:\/\/(.+)$/);
    if (noteMatch) {
      hits.push({ start: m.index, end: m.index + whole.length, chip: { kind: "note", label: label || "note", id: noteMatch[1] } });
    } else if (/^https?:\/\//i.test(target)) {
      const host = target.match(/^https?:\/\/([^/?#]+)/i)?.[1]?.replace(/^www\./i, "") ?? target;
      hits.push({ start: m.index, end: m.index + whole.length, chip: { kind: "url", label: host, href: target } });
    } else {
      hits.push({ start: m.index, end: m.index + whole.length, raw: whole });
    }
  }

  const claimed = (i: number) => hits.some((h) => i >= h.start && i < h.end);
  BARE_URL_RE.lastIndex = 0;
  while ((m = BARE_URL_RE.exec(text)) !== null) {
    if (claimed(m.index)) continue;
    const href = m[0].replace(/[).,;:!?]+$/, "");
    const host = href.match(/^https?:\/\/([^/?#]+)/i)?.[1]?.replace(/^www\./i, "") ?? href;
    hits.push({ start: m.index, end: m.index + href.length, chip: { kind: "url", label: host, href } });
  }

  // Extract tags to remove from title (they're displayed as separate chips)
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(text)) !== null) {
    if (claimed(m.index)) continue;
    const tag = m[1];
    hits.push({ start: m.index, end: m.index + m[0].length, chip: { kind: "tag", label: tag } });
  }

  hits.sort((a, b) => a.start - b.start);
  let title = "";
  let cursor = 0;
  for (const h of hits) {
    if (h.start < cursor) continue;
    title += text.slice(cursor, h.start);
    if (h.chip) chips.push(h.chip);
    else if (h.raw) title += h.raw;
    // Tags are skipped (not added to title, displayed as separate chips below)
    cursor = h.end;
  }
  title += text.slice(cursor);
  title = title.replace(/\s+/g, " ").trim().replace(/[\s]*[-–—:·•]+$/, "").trim();

  return { title, chips };
}
