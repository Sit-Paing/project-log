# Project Log

Project schedule log with a live plan vs actual timeline. Anyone with the link can view it.
Only people who know the edit passcode can change anything (the server checks it on every write).

Stack: Cloudflare Worker (API + static page) and a D1 database. No build step.

## Deploy (about 10 minutes)

You need a free Cloudflare account and a GitHub account.

1. **Put the code on GitHub.** Create a new repository, then from this folder:
   ```
   git init && git add . && git commit -m "Project Log"
   git branch -M main
   git remote add origin https://github.com/<you>/<repo>.git
   git push -u origin main
   ```
2. **Install and sign in to Cloudflare.**
   ```
   npm install
   npx wrangler login
   ```
3. **Create the database.**
   ```
   npx wrangler d1 create project-log
   ```
   Copy the `database_id` it prints into `wrangler.toml`, commit, and push.
4. **Create the tables** (and optionally load the BM3 job from your paper sheet).
   ```
   npm run db:migrate
   npm run db:seed
   ```
5. **Set the edit passcode.** Choose a long one (four or more random words works well).
   ```
   npx wrangler secret put EDIT_PASSCODE
   ```
6. **Deploy.**
   ```
   npm run deploy
   ```
   Wrangler prints your link, for example `https://project-log.<your-subdomain>.workers.dev`.
   Share that link with the team.

## Editing

Open the link, press **Unlock editing**, and enter the passcode. The browser remembers it on that device.
**Editing on · Lock** turns it off again. To change the passcode, run step 5 again; everyone is asked to
unlock again.

## Managing projects

Unlock editing first. Viewers see everything but none of these controls.

| To do this | Use |
| --- | --- |
| Add a new project | **New project** (top right). Leave "standard processes" ticked to start from the ME / EE / parts / automation list. |
| Edit an old project | **Edit project**: name, client, PO number, subject notes. **Delete project** is at the bottom of that window. |
| Start a new job from an old one | **Duplicate**. Copies main and sub processes and people in charge. Optionally copies plan dates and subject images. Actual dates are never copied. |
| Add subject images | **Add images** in the Subject section. Photos are shrunk in the browser before upload. Up to 12 per project. |
| Change a caption, reorder or delete an image | **Edit** on the image. |
| Add, edit or delete a process | **+ Add** on a main process, or click a process name. |
| Reorder processes | The up and down arrows under a process name (within its main process). |
| Rename a main process | **Rename** on the main process header. Use an existing name to merge two. |
| Log progress | **Start today**, **Finish today**, **Reopen**. |

`samples/` has two images cropped from the BM3 paper sheet. Open the BM3 project, press Add images, and pick them to try the Subject section.

## Deploy automatically on every push (optional)

The workflow in `.github/workflows/deploy.yml` deploys on each push to `main`. Add three secrets in
GitHub under Settings > Secrets and variables > Actions:

| Secret | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | A token from the "Edit Cloudflare Workers" template, plus the D1 Edit permission |
| `CLOUDFLARE_ACCOUNT_ID` | Shown on the Cloudflare dashboard, Workers & Pages overview |
| `EDIT_PASSCODE` | The same passcode as step 5 |

Alternative: in the Cloudflare dashboard, go to Workers & Pages > Create > Import a repository and pick
this repo.

## Custom domain

Cloudflare dashboard > Workers & Pages > project-log > Settings > Domains & Routes > Add.

## Stronger protection (optional)

A shared passcode is simple, but it is one secret for everyone. For named people and the ability to
remove one person, put Cloudflare Access (Zero Trust, free for up to 50 users) in front of the write
routes: create an Access application for the paths `/api/projects*` and `/api/tasks*` with a policy
limited to your team's emails. Viewing (`GET /api/data`) stays public.

## Local development

```
echo 'EDIT_PASSCODE=dev-pass' > .dev.vars
npm run db:migrate:local
npx wrangler d1 execute project-log --local --file=seed.sql
npm run dev
```

## API

`GET /api/data` and `GET /api/images/:id` are public. Everything else needs the header `x-edit-key: <passcode>`.

Images are stored in D1 as base64 text (no extra Cloudflare product to set up), which is why each is limited to about 1.3 MB and 12 per project.
