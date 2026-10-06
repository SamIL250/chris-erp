"use client";

import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { cx } from "@/utils/cx";

/**
 * Rich-text editor for product descriptions (PH1-07) — Tiptap's WYSIWYG
 * (chosen 2026-10-05, the "description (rich)" field the plan calls for;
 * PH4-06 static pages reuse this component). It emits HTML, which the
 * Convex mutation sanitizes on write (`lib/richText.ts`) — this component
 * never decides what's safe, it only authors.
 *
 * `immediatelyRender: false` keeps SSR/hydration honest (Tiptap touches
 * the DOM); heading levels are capped at what the sanitizer keeps (h2-h4),
 * so the editor can never offer a tag that gets stripped after save.
 */

type ToolbarItem = {
  key: string;
  label: string;
  title: string;
  className?: string;
  isActive: (editor: Editor) => boolean;
  run: (editor: Editor) => void;
};

const TOOLBAR: ToolbarItem[] = [
  {
    key: "bold",
    label: "B",
    title: "Bold",
    className: "font-bold",
    isActive: (editor) => editor.isActive("bold"),
    run: (editor) => editor.chain().focus().toggleBold().run(),
  },
  {
    key: "italic",
    label: "I",
    title: "Italic",
    className: "italic",
    isActive: (editor) => editor.isActive("italic"),
    run: (editor) => editor.chain().focus().toggleItalic().run(),
  },
  {
    key: "strike",
    label: "S",
    title: "Strikethrough",
    className: "line-through",
    isActive: (editor) => editor.isActive("strike"),
    run: (editor) => editor.chain().focus().toggleStrike().run(),
  },
  {
    key: "h2",
    label: "H2",
    title: "Heading 2",
    isActive: (editor) => editor.isActive("heading", { level: 2 }),
    run: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    key: "h3",
    label: "H3",
    title: "Heading 3",
    isActive: (editor) => editor.isActive("heading", { level: 3 }),
    run: (editor) => editor.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  {
    key: "bullet-list",
    label: "•≡",
    title: "Bullet list",
    isActive: (editor) => editor.isActive("bulletList"),
    run: (editor) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    key: "ordered-list",
    label: "1≡",
    title: "Numbered list",
    isActive: (editor) => editor.isActive("orderedList"),
    run: (editor) => editor.chain().focus().toggleOrderedList().run(),
  },
  {
    key: "blockquote",
    label: "❝",
    title: "Quote",
    isActive: (editor) => editor.isActive("blockquote"),
    run: (editor) => editor.chain().focus().toggleBlockquote().run(),
  },
  {
    key: "code-block",
    label: "</>",
    title: "Code block",
    isActive: (editor) => editor.isActive("codeBlock"),
    run: (editor) => editor.chain().focus().toggleCodeBlock().run(),
  },
  {
    key: "link",
    label: "🔗",
    title: "Link",
    isActive: (editor) => editor.isActive("link"),
    run: (editor) => {
      if (editor.isActive("link")) {
        editor.chain().focus().unsetLink().run();
        return;
      }
      const href = window.prompt("Link URL (https://…)");
      if (href !== null && href.trim() !== "") {
        editor.chain().focus().setLink({ href: href.trim() }).run();
      }
    },
  },
];

export function RichTextEditor({
  value,
  onChange,
  minHeightClass = "min-h-40",
}: {
  value: string;
  onChange: (html: string) => void;
  minHeightClass?: string;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3, 4] },
      }),
    ],
    content: value,
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    editorProps: {
      attributes: {
        class: cx("prose prose-sm max-w-none focus:outline-none", minHeightClass),
      },
    },
    onUpdate: ({ editor: current }) => onChange(current.getHTML()),
  });

  return (
    <div className="border-tertiary overflow-hidden rounded-lg border">
      <div className="border-tertiary flex flex-wrap gap-1 border-b bg-gray-50 p-1.5">
        {TOOLBAR.map((item) => (
          <button
            key={item.key}
            type="button"
            title={item.title}
            aria-label={item.title}
            aria-pressed={editor !== null ? item.isActive(editor) : false}
            disabled={editor === null}
            onMouseDown={(event) => event.preventDefault()} // keep the editor focused
            onClick={() => editor !== null && item.run(editor)}
            className={cx(
              "text-tertiary hover:bg-secondary aria-pressed:bg-brand-50 aria-pressed:text-brand-600 hover:text-primary rounded-md px-2 py-1 text-sm font-medium disabled:opacity-50",
              item.className,
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
