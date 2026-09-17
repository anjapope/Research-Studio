# Teaching & Instruction

Open the Teaching & Instruction tab and create a lesson. Set its title, course or audience, class length, and learning objectives.

Import PDF, DOCX, Markdown, or plain text readings, paste text, or add sources from the library. Library sources contribute abstracts, research notes, saved readable PDF pages, and evidence excerpts. Open each reading to review its coverage. Scanned PDFs need OCR in the existing reader before adding their saved text from the library. Imported text is stored with the lesson; original imported documents are not copied into managed storage by this workflow.

**Draft locally** generates an extractive reading synthesis, lecture notes, and slides without an external service. Repeated vocabulary is offered as a discussion prompt, not as proof that authors agree.

For AI synthesis, open **AI settings**, enter an OpenAI API key, and save. The default model is `gpt-4.1`; you can enter another model that supports Responses and structured outputs and is available to your API account. API usage is billed to that account. The key is encrypted using Electron's OS-backed secure storage in the app's user-data directory. It is never returned to the renderer after saving and is not included in workspace backups. Remove saved key deletes it from the app's configuration.

Click **Send readings & synthesize with AI** to send the lesson's source text, source titles, title, audience, class length, and objectives to OpenAI. Existing instructor drafts and other workspace records are not sent. The app uses the [OpenAI Responses API with structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs), with response storage disabled (`store: false`). This does not override OpenAI's API data policies. Requests are limited to 240,000 characters of serialized class context and readings; oversized requests are rejected before any transmission, without silently truncating readings. A request can run for up to three minutes and can be canceled. API errors, incomplete output, refusals, or invalid source markers leave existing drafts unchanged.

AI drafts include an integrated synthesis, lecture notes, and slides with speaker notes. Each output includes source references, and a successful AI draft records the model, timestamp, and input digest. These checks validate reference identifiers, not the factual accuracy of the model's interpretation. Review citations against the readings before class.

Edit the drafts and add your interpretation, examples, and teaching activities. Changing readings or objectives does not update existing outputs automatically. Regenerating replaces all three outputs after confirmation.

Save lesson stores the lesson and its source text in the workspace database. Unsaved changes are also saved when navigating away or closing the app. Lessons are included in workspace backups. Export notes or synthesis as Markdown. In Slides, choose **Export PowerPoint** for an editable `.pptx` or **Export HTML deck** for a browser or printing.

Separate slides with a line containing `---`; use `#` for slide titles. Put `???` on its own line before speaker notes. Notes are exported to PowerPoint's speaker notes and excluded from visible HTML slides. PowerPoint uses a simple widescreen layout with editable text and bullets; long bodies continue onto additional slides. Basic Markdown emphasis is converted to plain text. This is a text-deck exporter, not a Markdown table, image, or equation renderer. Shorten titles longer than 150 characters and split unusually large decks (over 100 input slides or 200,000 characters) before exporting.
