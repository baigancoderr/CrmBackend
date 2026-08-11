# Backblaze B2 Storage Integration — CRM Backend

Yeh document batata hai ki CRM mein Backblaze B2 cloud storage kaise connect kiya gaya, kya change hua, aur kyun.

---

## Kyun Backblaze?

Backblaze B2 ek **S3-compatible object storage** hai — AWS S3 jaisa API, lekin sasta aur simple pricing.

Supabase Storage ki jagah Backblaze use karne ke fayde:

| Feature | Backblaze B2 |
|---------|--------------|
| Pricing | ~$0.006/GB/month storage |
| API | S3-compatible (standard SDK) |
| CDN | Cloudflare integration free |
| Control | Apna bucket, apni policies |

---

## Architecture

```
User upload
    ↓
Multer (temp local file on server)
    ↓
storage.service.js
    ↓
STORAGE_PROVIDER = backblaze?
    ↙                    ↘
Backblaze B2 bucket    Local /uploads/ folder
    ↓                    ↓
Public URL (https://...)  Relative path (/uploads/...)
    ↓                    ↓
MongoDB mein fileUrl save
```

**Backend se upload kyun?**
- B2 Application Key server par safe rehti hai
- Multer file validation (type, size) same rehti hai
- `STORAGE_PROVIDER=local` se turant wapas local mode

---

## Environment Variables

`.env` mein yeh values add karein:

```env
STORAGE_PROVIDER=backblaze
B2_APPLICATION_KEY_ID=003abc123456789000000001
B2_APPLICATION_KEY=K003xxxxxxxxxxxxxxxxxxxx
B2_BUCKET_NAME=crm-dob
B2_REGION=us-west-004
B2_ENDPOINT=https://s3.us-west-004.backblazeb2.com
B2_PUBLIC_BASE_URL=https://f004.backblazeb2.com/file/crm-dob
```

| Variable | Kya hai | Kahan milega |
|----------|---------|--------------|
| `STORAGE_PROVIDER` | `backblaze` ya `local` | Aap set karte ho |
| `B2_APPLICATION_KEY_ID` | Key ID (keyId) | B2 → Application Keys |
| `B2_APPLICATION_KEY` | Secret key | B2 → Application Keys (sirf ek baar dikhti hai) |
| `B2_BUCKET_NAME` | Bucket ka naam | B2 → Buckets |
| `B2_REGION` | Bucket region | Bucket details mein |
| `B2_ENDPOINT` | S3 endpoint | `https://s3.<region>.backblazeb2.com` |
| `B2_PUBLIC_BASE_URL` | Public download URL base | Bucket → Friendly URL |

### `B2_PUBLIC_BASE_URL` kaise nikalein?

Backblaze dashboard → Bucket → **Bucket Settings**:

```
https://f004.backblazeb2.com/file/crm-dob
```

Yeh base URL hai. File path baad mein append hota hai:

```
https://f004.backblazeb2.com/file/crm-dob/employees/1234567890-photo.jpg
```

---

## Backblaze Dashboard Setup (Step-by-step)

### Step 1: Account + Bucket

1. [backblaze.com/b2](https://www.backblaze.com/b2/cloud-storage.html) par sign up
2. **Create a Bucket**
   - Name: `crm-dob` (lowercase, no spaces recommended)
   - Files in bucket: **Public** (CRM files browser se directly open hon)
   - Encryption: default

### Step 2: Application Key

1. **App Keys** → **Add a New Application Key**
2. Name: `crm-backend`
3. Allow access to Bucket: `crm-dob` (specific bucket select karein)
4. Capabilities: `readFiles`, `writeFiles`, `deleteFiles`, `listFiles`
5. **Create Key** — Key ID aur Application Key copy karein (key sirf ek baar dikhti hai)

### Step 3: Endpoint aur Region

Bucket details page se:

- **Region**: e.g. `us-west-004`
- **S3 Endpoint**: `https://s3.us-west-004.backblazeb2.com`

### Step 4: `.env` update + backend restart

```bash
cd crm-backend
npm run dev
```

---

## Nayi Backend Files

### `src/config/backblaze.js`

S3-compatible client banata hai Backblaze credentials se.

- Lazy init — env load hone ke baad hi connect
- `@aws-sdk/client-s3` use karta hai (B2 S3 API support karta hai)

### `src/services/storage.service.js`

Central storage layer — saare modules isi ko use karte hain.

| Function | Kaam |
|----------|------|
| `isBackblazeStorage()` | Provider check |
| `persistUploadedFile(file, key)` | Upload karke URL return |
| `deleteStoredFile(fileUrl)` | B2 ya local file delete |
| `buildPublicUrl(path)` | Public download URL banata hai |

**Folder mapping (bucket ke andar):**

| Key | B2 folder | Local fallback |
|-----|-----------|----------------|
| `employees` | `employees/` | `/uploads/employees/` |
| `chat` | `chat/` | `/api/uploads/chat/` |
| `tickets` | `tickets/` | `/uploads/tickets/` |
| `projects` | `projects/` | `/uploads/projects/` |
| `areas` | `areas/` | `/api/uploads/areas/` |
| `notes` | `notes/` | `/uploads/notes/` |

---

## Updated Modules

Har module mein sirf file save/delete logic change hui:

| Module | File |
|--------|------|
| Profile photos | `user/user.controller.js`, `user/user.service.js` |
| Chat files + group photo | `chat/chat.service.js` |
| Project documents | `project/projectDocument.service.js` |
| Work area docs | `project/projectArea.service.js` |
| Task attachments | `project/task/task.service.js` |
| Blockers | `project/blocker/blocker.service.js` |
| Task comments | `project/comments/taskComment.service.js` |
| Tickets | `tickets/ticket.service.js` |
| Ticket comments | `tickets/ticketComment.service.js` |
| Notes | `notes/notes.service.js` |

---

## Frontend

`crm-frontend/src/core/utils/fileUrl.ts`:

```typescript
resolveFileUrl(fileUrl)
```

- `https://...` URL → as-is return (Backblaze public URL)
- `/uploads/...` → backend server URL prepend (purani local files)

**Already compatible:**
- `userProfile.ts` — profile photos
- `projectService.ts` — document URLs
- `chat.tsx` — `toMediaUrl()` helper

---

## Local Mode (testing ke liye)

Cloud ke bina test karna ho to:

```env
STORAGE_PROVIDER=local
```

Backend restart — files phir `uploads/` folder mein save hongi.

---

## Testing Checklist

1. `.env` mein saari B2 values set karein
2. Backend restart: `npm run dev`
3. Profile photo upload → response mein `https://f00x.backblazeb2.com/file/...` URL
4. Chat mein image bhejein → message mein full URL
5. Backblaze dashboard → bucket mein file dikhe

---

## Troubleshooting

| Error | Fix |
|-------|-----|
| `B2_APPLICATION_KEY_ID ... required` | `.env` values check karein, backend restart |
| `Access Denied` | Application key ko bucket access do |
| Upload OK par file na dikhe | Bucket **Public** hona chahiye |
| Wrong URL | `B2_PUBLIC_BASE_URL` bucket friendly URL se match kare |
| Purani files nahi dikh rahi | Normal — woh ab bhi local `/uploads/` paths hain |

---

## Dependencies

```json
"@aws-sdk/client-s3": "^3.x"
```

Install: `npm install @aws-sdk/client-s3`

Supabase package hata diya gaya — ab sirf Backblaze B2 use hota hai.

---

## Security

- `B2_APPLICATION_KEY` ko **git mein commit mat karein**
- Application key sirf required bucket tak limited rakhein
- Production `.env` server par securely store karein
- Private files ke liye bucket public na rakhein — signed URLs alag se implement karne padenge

---

## Optional: Cloudflare CDN

Backblaze + Cloudflare free CDN setup se files faster serve hoti hain aur egress cost kam hoti hai.

Guide: [Backblaze + Cloudflare CDN](https://www.backblaze.com/docs/cloud-storage-deliver-public-backblaze-b2-content-through-cloudflare-cdn)
