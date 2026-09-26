/** OAuth scopes and tool contracts for the Google catalog integrations. */
export type GoogleAccess = "read" | "write";
const scope = (name: string) => `https://www.googleapis.com/auth/${name}`;
const driveReadTools = [
  "search",
  "listFolder",
  "listSharedDrives",
  "readTextFile",
  "readGoogleDoc",
  "readGoogleDocPaginated",
  "getGoogleDocContent",
  "listGoogleDocs",
  "getGoogleSheetContent",
  "getGoogleSheetCells",
  "getSpreadsheetInfo",
  "listSheets",
  "listGoogleSheets",
  "getGoogleSlidesContent",
  "getGoogleSlidesSpeakerNotes",
  "listPermissions",
  "getRevisions",
  "downloadFile",
];
export function googlePermissions(pluginId: string, access: GoogleAccess = "read") {
  switch (pluginId) {
    case "gmail":
      return {
        scopes: [scope("gmail.readonly"), ...(access === "write" ? [scope("gmail.compose")] : [])],
        tools: [
          "search_emails",
          "read_email",
          "list_email_labels",
          "download_attachment",
          ...(access === "write" ? ["draft_email", "send_email"] : []),
        ],
        description:
          access === "write"
            ? "Read email, manage drafts, and send email. Google combines drafting and sending in one permission."
            : "Read and search email and attachments. No sending or mailbox changes.",
        writeLabel: "Read, draft, and send email",
      };
    case "google-calendar":
      return {
        scopes: [
          scope("calendar.calendarlist.readonly"),
          scope(access === "write" ? "calendar.events" : "calendar.events.readonly"),
        ],
        tools: [
          "listCalendars",
          "getCalendarEvents",
          "getCalendarEvent",
          ...(access === "write" ? ["createCalendarEvent", "updateCalendarEvent", "deleteCalendarEvent"] : []),
        ],
        description:
          access === "write"
            ? "View calendars and create, edit, or delete events. No Drive or Gmail access."
            : "View your calendar list and events. No event changes, Drive, or Gmail access.",
        writeLabel: "Read and manage events",
      };
    case "google-drive":
      return {
        scopes: [scope(access === "write" ? "drive" : "drive.readonly")],
        tools: [
          ...driveReadTools,
          ...(access === "write"
            ? [
                "createTextFile",
                "updateTextFile",
                "createFolder",
                "renameItem",
                "moveItem",
                "copyFile",
                "deleteItem",
                "createGoogleDoc",
                "updateGoogleDoc",
                "createGoogleSheet",
                "updateGoogleSheet",
                "createGoogleSlides",
                "updateGoogleSlides",
              ]
            : []),
        ],
        description:
          access === "write"
            ? "Read and edit Drive files, Docs, Sheets, and Slides. Google grants access to all your Drive files, including deletion."
            : "Read and search Drive files, Docs, Sheets, and Slides. No file changes, Gmail, or Calendar access.",
        writeLabel: "Read and edit Drive files",
      };
    default:
      throw new Error("Unsupported Google plugin");
  }
}

export function validateGoogleScopes(requested: string, granted?: string): string {
  // OAuth permits omission of scope only when it is identical to the request.
  const effective = granted ?? requested;
  const actual = new Set(effective.split(/\s+/));
  if (requested.split(/\s+/).some((item) => !actual.has(item))) {
    throw new Error(
      "Google did not grant the selected permissions. Choose a lower access level or approve the requested access and try again.",
    );
  }
  return effective;
}
