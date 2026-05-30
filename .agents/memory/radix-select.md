---
name: Radix SelectItem empty string
description: shadcn/ui Select crashes if any SelectItem has value=""
---

**Rule:** Never use `value=""` on a `<SelectItem />`. Radix UI reserves empty string to mean "no selection / show placeholder" and throws a runtime error if a real item has it.

**Why:** Discovered when `/allocation` page crashed with "A <Select.Item /> must have a value prop that is not an empty string."

**How to apply:** For "no selection" options (e.g. "No builder profile"), use a sentinel value like `"none"` or `"__none__"` and filter it out in the submit handler:
```tsx
<SelectItem value="none">No builder profile</SelectItem>
// then in submit:
if (form.builderProfileId && form.builderProfileId !== "none") payload.builderProfileId = Number(form.builderProfileId);
```
