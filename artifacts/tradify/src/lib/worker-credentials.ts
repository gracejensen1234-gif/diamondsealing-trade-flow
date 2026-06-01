export const CREDENTIAL_TYPES = [
  { value: "white_card", label: "White Card" },
  { value: "scissor_lift", label: "Scissor Lift Licence" },
  { value: "ewp", label: "EWP Licence" },
  { value: "working_at_heights", label: "Working at Heights" },
  { value: "forklift", label: "Forklift Licence" },
  { value: "first_aid", label: "First Aid" },
  { value: "other", label: "Other Document" },
];

export type CredentialDraft = {
  documentType: string;
  expiryDate: string;
  notes: string;
};

export type WorkerCredential = {
  id: number;
  subcontractorId: number;
  subcontractorName?: string;
  documentType: string;
  label: string;
  imageData: string;
  fileName?: string | null;
  expiryDate?: string | null;
  notes?: string | null;
};

export function emptyCredentialDraft(): CredentialDraft {
  return { documentType: "white_card", expiryDate: "", notes: "" };
}

export function credentialLabel(documentType: string) {
  return CREDENTIAL_TYPES.find((type) => type.value === documentType)?.label ?? "Other Document";
}

export function compressCredentialImage(file: File) {
  return new Promise<string>((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("Only image uploads are supported"));
      return;
    }

    const image = new Image();
    const objectUrl = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const maxEdge = 1600;
      const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
      const width = Math.max(1, Math.round(image.width * scale));
      const height = Math.max(1, Math.round(image.height * scale));

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Could not prepare credential image"));
        return;
      }

      ctx.drawImage(image, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", 0.78));
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Could not read credential image"));
    };

    image.src = objectUrl;
  });
}
