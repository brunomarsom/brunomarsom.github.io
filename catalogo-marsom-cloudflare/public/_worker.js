const VALID_CATEGORIES = new Set([
  "estrutura",
  "boxtruss",
  "palco",
  "piso",
  "cenografia",
  "iluminacao",
  "outro",
]);

const VALID_STATUSES = new Set([
  "planejada",
  "em-andamento",
  "em-revisao",
  "concluida",
]);

const ALLOWED_ORIGINS = new Set([
  "https://brunomarsom.github.io",
  "http://localhost:4173",
  "http://terminal.local:4173",
]);

const MAX_FILE_SIZE = 100 * 1024 * 1024;
const MAX_MEDIA_PER_MONTAGE = 40;
let schemaReady;

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS montages (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    description TEXT DEFAULT '' NOT NULL,
    category TEXT DEFAULT 'estrutura' NOT NULL,
    status TEXT DEFAULT 'planejada' NOT NULL,
    client TEXT DEFAULT '' NOT NULL,
    event_name TEXT DEFAULT '' NOT NULL,
    location TEXT NOT NULL,
    latitude REAL,
    longitude REAL,
    occurred_date TEXT NOT NULL,
    occurred_time TEXT NOT NULL,
    responsible_member_id TEXT,
    responsible_name TEXT DEFAULT '' NOT NULL,
    responsible_role TEXT DEFAULT '' NOT NULL,
    cover_media_id TEXT,
    cover_kind TEXT,
    created_by_email TEXT DEFAULT '' NOT NULL,
    created_by_name TEXT DEFAULT 'Equipe Marsom' NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    archived_at TEXT
  )`,
  "CREATE INDEX IF NOT EXISTS montages_status_idx ON montages (status)",
  "CREATE INDEX IF NOT EXISTS montages_category_idx ON montages (category)",
  "CREATE INDEX IF NOT EXISTS montages_occurred_date_idx ON montages (occurred_date)",
  `CREATE TABLE IF NOT EXISTS montage_media (
    id TEXT PRIMARY KEY NOT NULL,
    montage_id TEXT NOT NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    r2_key TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    archived_at TEXT,
    FOREIGN KEY (montage_id) REFERENCES montages(id) ON DELETE CASCADE
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS montage_media_r2_key_unique ON montage_media (r2_key)",
  "CREATE INDEX IF NOT EXISTS montage_media_montage_idx ON montage_media (montage_id)",
  "CREATE INDEX IF NOT EXISTS montage_media_created_at_idx ON montage_media (created_at)",
  `CREATE TABLE IF NOT EXISTS team_members (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    email TEXT DEFAULT '' NOT NULL,
    phone TEXT DEFAULT '' NOT NULL,
    is_active INTEGER DEFAULT 1 NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS team_members_active_idx ON team_members (is_active)",
  "CREATE INDEX IF NOT EXISTS team_members_name_idx ON team_members (name)",
];

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function corsOrigin(request) {
  const origin = request.headers.get("Origin");
  if (origin && ALLOWED_ORIGINS.has(origin)) return origin;
  return request.method === "GET" || request.method === "HEAD" ? "*" : "";
}

function withCors(response, request) {
  const headers = new Headers(response.headers);
  const origin = corsOrigin(request);
  if (origin) headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Methods", "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS");
  headers.set(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, Range, X-Requested-With",
  );
  headers.set(
    "Access-Control-Expose-Headers",
    "Content-Length, Content-Range, ETag",
  );
  headers.set("Vary", "Origin");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function json(data, status = 200, headers = {}) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

function mediaUrl(url, id) {
  return `${url.origin}/api/media/${encodeURIComponent(id)}`;
}

function normalizeMontage(row, url) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    status: row.status,
    client: row.client,
    eventName: row.event_name,
    location: row.location,
    latitude: row.latitude ?? null,
    longitude: row.longitude ?? null,
    occurredDate: row.occurred_date,
    occurredTime: row.occurred_time,
    responsibleMemberId: row.responsible_member_id ?? null,
    responsibleName: row.responsible_name,
    responsibleRole: row.responsible_role,
    coverMediaId: row.cover_media_id ?? null,
    coverKind: row.cover_kind ?? null,
    coverUrl: row.cover_media_id ? mediaUrl(url, row.cover_media_id) : null,
    mediaCount: Number(row.media_count ?? 0),
    createdByEmail: row.created_by_email,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeMedia(row, url) {
  return {
    id: row.id,
    montageId: row.montage_id,
    name: row.name,
    kind: row.kind,
    contentType: row.content_type,
    size: Number(row.size),
    url: mediaUrl(url, row.id),
    createdAt: row.created_at,
    ...(row.title !== undefined ? { title: row.title } : {}),
    ...(row.location !== undefined ? { location: row.location } : {}),
  };
}

function normalizeMember(row) {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    email: row.email,
    phone: row.phone,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function safeFilename(value) {
  return (
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(-100) || "arquivo"
  );
}

function isSupportedType(contentType) {
  return contentType.startsWith("image/") || contentType.startsWith("video/");
}

function safeId(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

async function ensureSchema(env) {
  if (!schemaReady) {
    schemaReady = env.DB.batch(
      SCHEMA_STATEMENTS.map((statement) => env.DB.prepare(statement)),
    )
      .then(() => undefined)
      .catch((error) => {
        schemaReady = undefined;
        throw error;
      });
  }
  await schemaReady;
}

async function handleMontagesCollection(request, env, url) {
  if (request.method === "GET") {
    const search = cleanText(url.searchParams.get("search"), 100);
    const status = cleanText(url.searchParams.get("status"), 40);
    const category = cleanText(url.searchParams.get("category"), 40);
    const conditions = ["m.archived_at IS NULL"];
    const values = [];

    if (search) {
      conditions.push(
        "(m.title LIKE ? OR m.location LIKE ? OR m.client LIKE ? OR m.event_name LIKE ? OR m.responsible_name LIKE ?)",
      );
      const pattern = `%${search}%`;
      values.push(pattern, pattern, pattern, pattern, pattern);
    }
    if (VALID_STATUSES.has(status)) {
      conditions.push("m.status = ?");
      values.push(status);
    }
    if (VALID_CATEGORIES.has(category)) {
      conditions.push("m.category = ?");
      values.push(category);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const recordsStatement = env.DB.prepare(
      `SELECT m.*, COUNT(mm.id) AS media_count
       FROM montages m
       LEFT JOIN montage_media mm ON mm.montage_id = m.id
       ${where}
       GROUP BY m.id
       ORDER BY m.occurred_date DESC, m.occurred_time DESC
       LIMIT 150`,
    ).bind(...values);

    const [recordsResult, summary, mediaSummary, mediaResult] = await Promise.all([
      recordsStatement.all(),
      env.DB.prepare(
        `SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status IN ('planejada','em-andamento','em-revisao') THEN 1 ELSE 0 END) AS in_progress,
          SUM(CASE WHEN occurred_date = date('now','-3 hours') THEN 1 ELSE 0 END) AS today
         FROM montages
         WHERE archived_at IS NULL`,
      ).first(),
      env.DB.prepare(
        "SELECT COUNT(*) AS total FROM montage_media WHERE archived_at IS NULL",
      ).first(),
      env.DB.prepare(
        `SELECT mm.*, m.title, m.location
         FROM montage_media mm
         INNER JOIN montages m ON m.id = mm.montage_id
         WHERE mm.archived_at IS NULL AND m.archived_at IS NULL
         ORDER BY mm.created_at DESC
         LIMIT 300`,
      ).all(),
    ]);

    return json({
      records: (recordsResult.results ?? []).map((row) =>
        normalizeMontage(row, url),
      ),
      media: (mediaResult.results ?? []).map((row) => normalizeMedia(row, url)),
      summary: {
        total: Number(summary?.total ?? 0),
        inProgress: Number(summary?.in_progress ?? 0),
        today: Number(summary?.today ?? 0),
        media: Number(mediaSummary?.total ?? 0),
      },
    });
  }

  if (request.method === "POST") {
    const payload = await request.json();
    const title = cleanText(payload.title, 140);
    const location = cleanText(payload.location, 180);
    const occurredDate = cleanText(payload.occurredDate, 10);
    const occurredTime = cleanText(payload.occurredTime, 5);
    const category = cleanText(payload.category, 40);
    const status = cleanText(payload.status, 40);

    if (!title || !location || !occurredDate || !occurredTime) {
      return json(
        { error: "Informe nome, local, data e hora da montagem." },
        400,
      );
    }
    if (!VALID_CATEGORIES.has(category) || !VALID_STATUSES.has(status)) {
      return json({ error: "Categoria ou etapa inválida." }, 400);
    }

    const latitude =
      typeof payload.latitude === "number" && Number.isFinite(payload.latitude)
        ? payload.latitude
        : null;
    const longitude =
      typeof payload.longitude === "number" && Number.isFinite(payload.longitude)
        ? payload.longitude
        : null;
    const id = crypto.randomUUID();
    const row = await env.DB.prepare(
      `INSERT INTO montages (
        id, title, description, category, status, client, event_name, location,
        latitude, longitude, occurred_date, occurred_time,
        responsible_member_id, responsible_name, responsible_role,
        created_by_email, created_by_name
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *`,
    )
      .bind(
        id,
        title,
        cleanText(payload.description, 3000),
        category,
        status,
        cleanText(payload.client, 160),
        cleanText(payload.eventName, 180),
        location,
        latitude,
        longitude,
        occurredDate,
        occurredTime,
        cleanText(payload.responsibleMemberId, 80) || null,
        cleanText(payload.responsibleName, 140),
        cleanText(payload.responsibleRole, 120),
        "",
        "Equipe Marsom",
      )
      .first();

    return json({ record: normalizeMontage(row, url) }, 201);
  }

  return json({ error: "Método não permitido." }, 405);
}

async function handleMontageItem(request, env, url, id) {
  if (request.method === "GET") {
    const row = await env.DB.prepare(
      "SELECT * FROM montages WHERE id = ? AND archived_at IS NULL LIMIT 1",
    )
      .bind(id)
      .first();
    if (!row) return json({ error: "Montagem não encontrada." }, 404);

    const mediaResult = await env.DB.prepare(
      `SELECT * FROM montage_media
       WHERE montage_id = ? AND archived_at IS NULL
       ORDER BY created_at DESC`,
    )
      .bind(id)
      .all();
    return json({
      record: {
        ...normalizeMontage(row, url),
        media: (mediaResult.results ?? []).map((item) =>
          normalizeMedia(item, url),
        ),
      },
    });
  }

  if (request.method === "PATCH") {
    const payload = await request.json();
    const fieldMap = {
      title: "title",
      description: "description",
      category: "category",
      status: "status",
      client: "client",
      eventName: "event_name",
      location: "location",
      occurredDate: "occurred_date",
      occurredTime: "occurred_time",
      responsibleMemberId: "responsible_member_id",
      responsibleName: "responsible_name",
      responsibleRole: "responsible_role",
    };
    const sets = [];
    const values = [];

    for (const [field, column] of Object.entries(fieldMap)) {
      if (payload[field] === undefined) continue;
      const value = cleanText(
        payload[field],
        field === "description" ? 3000 : 180,
      );
      if (field === "status" && !VALID_STATUSES.has(value)) {
        return json({ error: "Etapa inválida." }, 400);
      }
      if (field === "category" && !VALID_CATEGORIES.has(value)) {
        return json({ error: "Categoria inválida." }, 400);
      }
      sets.push(`${column} = ?`);
      values.push(value || (field === "responsibleMemberId" ? null : ""));
    }

    if (!sets.length) return json({ error: "Nenhuma alteração válida." }, 400);
    sets.push("updated_at = ?");
    values.push(new Date().toISOString(), id);
    const row = await env.DB.prepare(
      `UPDATE montages
       SET ${sets.join(", ")}
       WHERE id = ? AND archived_at IS NULL
       RETURNING *`,
    )
      .bind(...values)
      .first();
    if (!row) return json({ error: "Montagem não encontrada." }, 404);
    return json({ record: normalizeMontage(row, url) });
  }

  if (request.method === "DELETE") {
    const result = await env.DB.prepare(
      `UPDATE montages
       SET archived_at = ?, updated_at = ?
       WHERE id = ? AND archived_at IS NULL
       RETURNING id`,
    )
      .bind(new Date().toISOString(), new Date().toISOString(), id)
      .first();
    if (!result) return json({ error: "Montagem não encontrada." }, 404);
    return json({ ok: true });
  }

  return json({ error: "Método não permitido." }, 405);
}

async function handleMontageMedia(request, env, url, montageId) {
  if (request.method === "POST") {
    const payload = await request.json();
    const name = cleanText(payload.name, 180);
    const contentType = cleanText(payload.contentType, 120).toLowerCase();
    const size =
      typeof payload.size === "number" && Number.isFinite(payload.size)
        ? Math.round(payload.size)
        : 0;

    if (!name || !isSupportedType(contentType)) {
      return json({ error: "Selecione uma foto ou um vídeo válido." }, 400);
    }
    if (size <= 0 || size > MAX_FILE_SIZE) {
      return json({ error: "Cada arquivo pode ter no máximo 100 MB." }, 400);
    }

    const [record, mediaCount] = await Promise.all([
      env.DB.prepare(
        "SELECT id FROM montages WHERE id = ? AND archived_at IS NULL LIMIT 1",
      )
        .bind(montageId)
        .first(),
      env.DB.prepare(
        `SELECT COUNT(*) AS total FROM montage_media
         WHERE montage_id = ? AND archived_at IS NULL`,
      )
        .bind(montageId)
        .first(),
    ]);
    if (!record) return json({ error: "Montagem não encontrada." }, 404);
    if (Number(mediaCount?.total ?? 0) >= MAX_MEDIA_PER_MONTAGE) {
      return json(
        { error: "Esta montagem já atingiu o limite de 40 mídias." },
        400,
      );
    }

    const mediaId = crypto.randomUUID();
    const key = `montagens/${montageId}/${mediaId}-${safeFilename(name)}`;
    const upload = await env.BUCKET.createMultipartUpload(key, {
      httpMetadata: { contentType },
      customMetadata: {
        montageId,
        mediaId,
        originalName: name,
      },
    });

    return json({
      mediaId,
      key,
      uploadId: upload.uploadId,
      partSize: 5 * 1024 * 1024,
    });
  }

  if (request.method === "PUT") {
    const uploadId = cleanText(url.searchParams.get("uploadId"), 180);
    const key = cleanText(url.searchParams.get("key"), 500);
    const partNumber = Number(url.searchParams.get("partNumber"));
    if (
      !uploadId ||
      !key.startsWith(`montagens/${montageId}/`) ||
      !Number.isInteger(partNumber) ||
      partNumber < 1 ||
      partNumber > 100 ||
      !request.body
    ) {
      return json({ error: "Parte de upload inválida." }, 400);
    }
    const part = await env.BUCKET.resumeMultipartUpload(
      key,
      uploadId,
    ).uploadPart(partNumber, request.body);
    return json({ partNumber: part.partNumber, etag: part.etag });
  }

  if (request.method === "PATCH") {
    const payload = await request.json();
    const uploadId = cleanText(payload.uploadId, 180);
    const key = cleanText(payload.key, 500);
    const mediaId = cleanText(payload.mediaId, 80);
    const name = cleanText(payload.name, 180);
    const contentType = cleanText(payload.contentType, 120).toLowerCase();
    const size =
      typeof payload.size === "number" && Number.isFinite(payload.size)
        ? Math.round(payload.size)
        : 0;
    const parts = Array.isArray(payload.parts)
      ? payload.parts
          .map((item) => ({
            partNumber: Number(item?.partNumber),
            etag: cleanText(item?.etag, 180),
          }))
          .filter(
            (item) =>
              Number.isInteger(item.partNumber) &&
              item.partNumber > 0 &&
              item.partNumber <= 100 &&
              item.etag,
          )
          .sort((a, b) => a.partNumber - b.partNumber)
      : [];

    if (
      !uploadId ||
      !mediaId ||
      !key.startsWith(`montagens/${montageId}/${mediaId}-`) ||
      !name ||
      !isSupportedType(contentType) ||
      size <= 0 ||
      size > MAX_FILE_SIZE ||
      !parts.length
    ) {
      return json({ error: "Não foi possível concluir este upload." }, 400);
    }

    const montage = await env.DB.prepare(
      `SELECT id, cover_media_id FROM montages
       WHERE id = ? AND archived_at IS NULL
       LIMIT 1`,
    )
      .bind(montageId)
      .first();
    if (!montage) {
      await env.BUCKET.resumeMultipartUpload(key, uploadId).abort();
      return json({ error: "Montagem não encontrada." }, 404);
    }

    await env.BUCKET.resumeMultipartUpload(key, uploadId).complete(parts);
    const kind = contentType.startsWith("video/") ? "video" : "photo";
    try {
      await env.DB.prepare(
        `INSERT INTO montage_media
          (id, montage_id, name, kind, content_type, size, r2_key)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(mediaId, montageId, name, kind, contentType, size, key)
        .run();
      if (!montage.cover_media_id) {
        await env.DB.prepare(
          `UPDATE montages
           SET cover_media_id = ?, cover_kind = ?, updated_at = ?
           WHERE id = ? AND cover_media_id IS NULL`,
        )
          .bind(mediaId, kind, new Date().toISOString(), montageId)
          .run();
      }
    } catch (error) {
      await env.BUCKET.delete(key);
      throw error;
    }

    return json(
      {
        media: {
          id: mediaId,
          montageId,
          name,
          kind,
          contentType,
          size,
          url: mediaUrl(url, mediaId),
          createdAt: new Date().toISOString(),
        },
      },
      201,
    );
  }

  if (request.method === "DELETE") {
    const payload = await request.json().catch(() => ({}));
    const uploadId = cleanText(payload.uploadId, 180);
    const key = cleanText(payload.key, 500);
    if (uploadId && key.startsWith(`montagens/${montageId}/`)) {
      await env.BUCKET.resumeMultipartUpload(key, uploadId)
        .abort()
        .catch(() => undefined);
    }
    return json({ ok: true });
  }

  return json({ error: "Método não permitido." }, 405);
}

function inlineFilename(name) {
  return `inline; filename*=UTF-8''${encodeURIComponent(name)}`;
}

async function handleMedia(request, env, id) {
  const media = await env.DB.prepare(
    `SELECT * FROM montage_media
     WHERE id = ? AND archived_at IS NULL
     LIMIT 1`,
  )
    .bind(id)
    .first();
  if (!media) return new Response("Mídia não encontrada.", { status: 404 });

  if (request.method === "GET" || request.method === "HEAD") {
    const rangeHeader = request.headers.get("Range");
    let range;
    if (rangeHeader) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
      if (!match) {
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${media.size}` },
        });
      }
      const requestedStart = match[1] ? Number(match[1]) : null;
      const requestedEnd = match[2] ? Number(match[2]) : null;
      const start =
        requestedStart ??
        Math.max(0, media.size - Math.max(1, requestedEnd ?? media.size));
      const end = Math.min(
        media.size - 1,
        requestedStart === null
          ? media.size - 1
          : (requestedEnd ?? media.size - 1),
      );
      if (
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        start < 0 ||
        end < start ||
        start >= media.size
      ) {
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${media.size}` },
        });
      }
      range = { offset: start, length: end - start + 1 };
    }

    const object =
      request.method === "HEAD"
        ? await env.BUCKET.head(media.r2_key)
        : await env.BUCKET.get(
            media.r2_key,
            range ? { range } : undefined,
          );
    if (!object) return new Response("Arquivo não encontrado.", { status: 404 });

    const headers = new Headers({
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=3600",
      "Content-Disposition": inlineFilename(media.name),
      "Content-Type": media.content_type,
    });
    if (object.httpEtag) headers.set("ETag", object.httpEtag);
    if (range) {
      headers.set(
        "Content-Range",
        `bytes ${range.offset}-${range.offset + range.length - 1}/${media.size}`,
      );
      headers.set("Content-Length", String(range.length));
    } else {
      headers.set("Content-Length", String(media.size));
    }
    return new Response(
      request.method === "HEAD" ? null : object.body,
      { status: range ? 206 : 200, headers },
    );
  }

  if (request.method === "DELETE") {
    await env.DB.prepare(
      "UPDATE montage_media SET archived_at = ? WHERE id = ?",
    )
      .bind(new Date().toISOString(), id)
      .run();
    const montage = await env.DB.prepare(
      "SELECT cover_media_id FROM montages WHERE id = ? LIMIT 1",
    )
      .bind(media.montage_id)
      .first();
    if (montage?.cover_media_id === id) {
      const next = await env.DB.prepare(
        `SELECT id, kind FROM montage_media
         WHERE montage_id = ? AND archived_at IS NULL
         ORDER BY created_at DESC
         LIMIT 1`,
      )
        .bind(media.montage_id)
        .first();
      await env.DB.prepare(
        `UPDATE montages
         SET cover_media_id = ?, cover_kind = ?, updated_at = ?
         WHERE id = ?`,
      )
        .bind(
          next?.id ?? null,
          next?.kind ?? null,
          new Date().toISOString(),
          media.montage_id,
        )
        .run();
    }
    return json({ ok: true });
  }

  return json({ error: "Método não permitido." }, 405);
}

async function handleTeamCollection(request, env) {
  if (request.method === "GET") {
    const result = await env.DB.prepare(
      "SELECT * FROM team_members ORDER BY is_active DESC, name ASC",
    ).all();
    return json({
      members: (result.results ?? []).map(normalizeMember),
    });
  }

  if (request.method === "POST") {
    const payload = await request.json();
    const name = cleanText(payload.name, 140);
    const role = cleanText(payload.role, 120);
    if (!name || !role) {
      return json({ error: "Informe o nome e a função." }, 400);
    }
    const row = await env.DB.prepare(
      `INSERT INTO team_members (id, name, role, email, phone)
       VALUES (?, ?, ?, ?, ?)
       RETURNING *`,
    )
      .bind(
        crypto.randomUUID(),
        name,
        role,
        cleanText(payload.email, 180),
        cleanText(payload.phone, 40),
      )
      .first();
    return json({ member: normalizeMember(row) }, 201);
  }

  return json({ error: "Método não permitido." }, 405);
}

async function handleTeamItem(request, env, id) {
  if (request.method === "PATCH") {
    const payload = await request.json();
    const fieldMap = {
      name: "name",
      role: "role",
      email: "email",
      phone: "phone",
    };
    const sets = [];
    const values = [];
    for (const [field, column] of Object.entries(fieldMap)) {
      if (payload[field] === undefined) continue;
      sets.push(`${column} = ?`);
      values.push(cleanText(payload[field], field === "phone" ? 40 : 180));
    }
    if (typeof payload.isActive === "boolean") {
      sets.push("is_active = ?");
      values.push(payload.isActive ? 1 : 0);
    }
    if (!sets.length) return json({ error: "Nenhuma alteração válida." }, 400);
    sets.push("updated_at = ?");
    values.push(new Date().toISOString(), id);
    const row = await env.DB.prepare(
      `UPDATE team_members SET ${sets.join(", ")} WHERE id = ? RETURNING *`,
    )
      .bind(...values)
      .first();
    if (!row) return json({ error: "Integrante não encontrado." }, 404);
    return json({ member: normalizeMember(row) });
  }

  if (request.method === "DELETE") {
    await env.DB.prepare(
      "UPDATE team_members SET is_active = 0, updated_at = ? WHERE id = ?",
    )
      .bind(new Date().toISOString(), id)
      .run();
    return json({ ok: true });
  }

  return json({ error: "Método não permitido." }, 405);
}

async function route(request, env) {
  const url = new URL(request.url);
  const pathname = url.pathname.replace(/\/+$/, "") || "/";

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }

  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    const origin = request.headers.get("Origin");
    if (!origin || !ALLOWED_ORIGINS.has(origin)) {
      return json(
        { error: "Alterações são aceitas somente pelo catálogo oficial." },
        403,
      );
    }
    const editKey = cleanText(env.EDIT_KEY, 256);
    const authorization = request.headers.get("Authorization") ?? "";
    if (!editKey || authorization !== `Bearer ${editKey}`) {
      return json(
        { error: "Código da equipe inválido. Digite novamente." },
        401,
        { "WWW-Authenticate": "Bearer" },
      );
    }
  }

  await ensureSchema(env);

  if (pathname === "/api/montages") {
    return handleMontagesCollection(request, env, url);
  }
  if (pathname === "/api/team") {
    return handleTeamCollection(request, env);
  }

  const montageMediaMatch = pathname.match(
    /^\/api\/montages\/([^/]+)\/media$/,
  );
  if (montageMediaMatch) {
    return handleMontageMedia(
      request,
      env,
      url,
      safeId(montageMediaMatch[1]),
    );
  }

  const montageMatch = pathname.match(/^\/api\/montages\/([^/]+)$/);
  if (montageMatch) {
    return handleMontageItem(
      request,
      env,
      url,
      safeId(montageMatch[1]),
    );
  }

  const mediaMatch = pathname.match(/^\/api\/media\/([^/]+)$/);
  if (mediaMatch) {
    return handleMedia(request, env, safeId(mediaMatch[1]));
  }

  const teamMatch = pathname.match(/^\/api\/team\/([^/]+)$/);
  if (teamMatch) {
    return handleTeamItem(request, env, safeId(teamMatch[1]));
  }

  if (pathname === "/") {
    return json({
      ok: true,
      service: "Catálogo de Montagens Marsom",
    });
  }

  return json({ error: "Rota não encontrada." }, 404);
}

export default {
  async fetch(request, env) {
    try {
      return withCors(await route(request, env), request);
    } catch (error) {
      return withCors(
        json(
          {
            error:
              error instanceof Error
                ? error.message
                : "Não foi possível processar a solicitação.",
          },
          500,
        ),
        request,
      );
    }
  },
};
