"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  Building2,
  Crosshair,
  EyeOff,
  Loader2,
  MapPin,
  Plus,
  RefreshCw,
  Server,
  ShieldAlert,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";

import { assessEnterpriseAssets } from "@/lib/api";
import { getFirebaseDb } from "@/lib/firebase";
import {
  EnterpriseAsset,
  EnterpriseAssetAssessment,
  EnterpriseAssetType,
  EnterpriseConfidentiality,
  UserRole,
} from "@/types/quakelens";

const ASSET_TYPE_LABELS: Record<EnterpriseAssetType, string> = {
  server_room: "サーバー室 / マシンルーム",
  datacenter: "データセンター",
  bcp_hq: "BCP対策本部",
  vault: "重要機器・機密保管庫",
  warehouse: "防災備蓄・物流拠点",
};

const CONFIDENTIALITY_LABELS: Record<EnterpriseConfidentiality, string> = {
  enterprise_only: "自社専用・完全非公開（一般市民・他社・行政から秘匿）",
  gov_emergency_share: "災害時の救助連携のため政府機関へも共有",
};

const KYOTO_WARDS = [
  "中京区",
  "下京区",
  "上京区",
  "左京区",
  "右京区",
  "東山区",
  "山科区",
  "伏見区",
  "南区",
  "北区",
  "西京区",
];

interface EnterpriseAssetsPanelProps {
  userUid: string;
  userRole: UserRole;
  organizationName: string;
  pickedCoords: { lat: number; lon: number } | null;
  pickActive: boolean;
  onRequestMapPick: () => void;
  onCancelMapPick: () => void;
  onFocusAsset: (asset: EnterpriseAsset) => void;
  onAssetsLoaded?: (assets: EnterpriseAsset[]) => void;
}

export default function EnterpriseAssetsPanel({
  userUid,
  userRole,
  organizationName,
  pickedCoords,
  pickActive,
  onRequestMapPick,
  onCancelMapPick,
  onFocusAsset,
  onAssetsLoaded,
}: EnterpriseAssetsPanelProps) {
  const [assets, setAssets] = useState<EnterpriseAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [firestoreError, setFirestoreError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [assetType, setAssetType] = useState<EnterpriseAssetType>("server_room");
  const [confidentiality, setConfidentiality] =
    useState<EnterpriseConfidentiality>("enterprise_only");
  const [wardName, setWardName] = useState("下京区");
  const [latOverride, setLatOverride] = useState<string | null>(null);
  const [lonOverride, setLonOverride] = useState<string | null>(null);
  const latStr = latOverride ?? (pickedCoords ? pickedCoords.lat.toFixed(6) : "35.0036");
  const lonStr = lonOverride ?? (pickedCoords ? pickedCoords.lon.toFixed(6) : "135.7595");
  const [floorInfo, setFloorInfo] = useState("");
  const [backupHoursStr, setBackupHoursStr] = useState("72");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const [assessments, setAssessments] = useState<
    Record<string, EnterpriseAssetAssessment>
  >({});
  const [assessing, setAssessing] = useState(false);
  const [assessError, setAssessError] = useState<string | null>(null);

  useEffect(() => {
    const db = getFirebaseDb();
    if (!db || !userUid) {
      queueMicrotask(() => setLoading(false));
      return;
    }

    const col = collection(db, "enterprise_assets");
    const q =
      userRole === "government"
        ? query(
            col,
            where("confidentialityLevel", "==", "gov_emergency_share"),
            orderBy("createdAt", "desc"),
            limit(50)
          )
        : query(
            col,
            where("ownerUid", "==", userUid),
            orderBy("createdAt", "desc"),
            limit(50)
          );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: EnterpriseAsset[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            ownerUid: String(data.ownerUid || ""),
            organizationName: String(data.organizationName || ""),
            name: String(data.name || ""),
            assetType: (data.assetType as EnterpriseAssetType) || "server_room",
            confidentialityLevel:
              (data.confidentialityLevel as EnterpriseConfidentiality) ||
              "enterprise_only",
            wardName: String(data.wardName || "京都市"),
            lat: Number(data.lat || 0),
            lon: Number(data.lon || 0),
            floorInfo: typeof data.floorInfo === "string" ? data.floorInfo : "",
            backupHours:
              typeof data.backupHours === "number" ? data.backupHours : null,
            notes: typeof data.notes === "string" ? data.notes : "",
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
          };
        });
        setAssets(list);
        onAssetsLoaded?.(list);
        setFirestoreError(null);
        setLoading(false);
      },
      (err) => {
        console.error("Firestore enterprise_assets error:", err);
        const code =
          typeof err === "object" && err !== null && "code" in err
            ? String((err as { code?: unknown }).code || "")
            : "";
        if (code === "permission-denied" && userRole === "government") {
          setFirestoreError(
            "政府機関での共有企業拠点のFirestore参照には、管理者による政府機関クレーム（Custom Claim または管理権限設定）の付与が必要です。"
          );
        } else {
          setFirestoreError(
            err instanceof Error ? err.message : "企業拠点データの取得に失敗しました。"
          );
        }
        setLoading(false);
      }
    );

    return () => unsub();
  }, [userUid, userRole, onAssetsLoaded]);

  const runAssessAll = useCallback(async () => {
    if (userRole !== "enterprise" || assets.length === 0) return;
    setAssessing(true);
    setAssessError(null);
    try {
      const res = await assessEnterpriseAssets(
        assets.map((a) => ({
          id: a.id,
          asset_type: a.assetType,
          lat: a.lat,
          lon: a.lon,
        }))
      );
      const map: Record<string, EnterpriseAssetAssessment> = {};
      for (const item of res.assessments) {
        map[item.id] = item;
      }
      setAssessments(map);
    } catch (err) {
      setAssessError(
        err instanceof Error ? err.message : "インメモリ耐震診断に失敗しました。"
      );
    } finally {
      setAssessing(false);
    }
  }, [assets, userRole]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (userRole !== "enterprise") return;
    const db = getFirebaseDb();
    if (!db) {
      setFirestoreError("Firestore が未設定です。");
      return;
    }
    const lat = Number(latStr);
    const lon = Number(lonStr);
    if (!name.trim() || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      setFirestoreError("拠点名と有効な緯度・経度を入力してください。");
      return;
    }

    setSaving(true);
    setFirestoreError(null);
    try {
      const backupNum = backupHoursStr.trim() ? Number(backupHoursStr) : null;
      await addDoc(collection(db, "enterprise_assets"), {
        ownerUid: userUid,
        organizationName: organizationName || "登録企業",
        name: name.trim(),
        assetType,
        confidentialityLevel: confidentiality,
        wardName,
        lat,
        lon,
        floorInfo: floorInfo.trim(),
        backupHours:
          backupNum !== null && Number.isFinite(backupNum) ? backupNum : null,
        notes: notes.trim(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setName("");
      setFloorInfo("");
      setNotes("");
      setShowForm(false);
      onCancelMapPick();
    } catch (err) {
      setFirestoreError(
        err instanceof Error ? err.message : "非公開拠点の登録に失敗しました。"
      );
    } finally {
      setSaving(false);
    }
  };

  const handleToggleShare = async (asset: EnterpriseAsset) => {
    if (userRole !== "enterprise" || asset.ownerUid !== userUid) return;
    const db = getFirebaseDb();
    if (!db) return;
    const nextLevel: EnterpriseConfidentiality =
      asset.confidentialityLevel === "enterprise_only"
        ? "gov_emergency_share"
        : "enterprise_only";
    try {
      await updateDoc(doc(db, "enterprise_assets", asset.id), {
        confidentialityLevel: nextLevel,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      setFirestoreError(
        err instanceof Error ? err.message : "公開区分変更に失敗しました。"
      );
    }
  };

  const handleDelete = async (asset: EnterpriseAsset) => {
    if (userRole !== "enterprise" || asset.ownerUid !== userUid) return;
    const db = getFirebaseDb();
    if (!db) return;
    try {
      await deleteDoc(doc(db, "enterprise_assets", asset.id));
    } catch (err) {
      setFirestoreError(
        err instanceof Error ? err.message : "拠点削除に失敗しました。"
      );
    }
  };

  return (
    <div className="space-y-4">
      {/* Security Isolation Notice */}
      <div className="rounded-xl border border-emerald-500/35 bg-emerald-950/30 p-3.5 text-xs text-emerald-100">
        <div className="flex items-center gap-2 font-bold text-emerald-300">
          <EyeOff className="h-4 w-4 shrink-0" />
          {userRole === "government"
            ? "企業から災害緊急連携用に共有許可された重要拠点のみ表示"
            : "企業重要施設（サーバー室・DC等）のゼロトラスト隔離保護"}
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-emerald-100/85">
          {userRole === "government"
            ? "企業アカウントが「政府機関へも共有」を明示した拠点のみ閲覧できます。企業秘密拠点は自治体側からも不可視です。"
            : "登録された座標・設備情報は Firestore Security Rules により自社UID専用として暗号化通信・アクセス制御され、一般市民・競合他社から位置は一切分かりません。"}
        </p>
      </div>

      {userRole === "enterprise" && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500"
          >
            <Plus className="h-3.5 w-3.5" />
            {showForm ? "登録フォームを閉じる" : "非公開拠点を登録"}
          </button>

          <button
            type="button"
            disabled={assessing || assets.length === 0}
            onClick={() => void runAssessAll()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/15 px-3 py-1.5 text-xs font-semibold text-sky-200 hover:bg-sky-500/25 disabled:opacity-45"
          >
            {assessing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            即時ハザード・迂回影響診断（非保存）
          </button>
        </div>
      )}

      {(showForm || Boolean(pickedCoords)) && userRole === "enterprise" && (
        <form
          onSubmit={handleCreate}
          className="space-y-3 rounded-xl border border-slate-700 bg-slate-900/95 p-3.5 text-xs"
        >
          <div className="flex items-center justify-between">
            <span className="font-bold text-white">新規・自社機密拠点の登録</span>
            <button
              type="button"
              onClick={() => {
                if (pickActive) {
                  onCancelMapPick();
                } else {
                  setLatOverride(null);
                  setLonOverride(null);
                  setShowForm(true);
                  onRequestMapPick();
                }
              }}
              className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-semibold ${
                pickActive
                  ? "border-amber-400 bg-amber-500/20 text-amber-200"
                  : "border-sky-500/40 bg-sky-500/15 text-sky-200 hover:bg-sky-500/25"
              }`}
            >
              <Crosshair className="h-3 w-3" />
              {pickActive ? "地図上をクリックしてください（中止）" : "地図クリックで座標取得"}
            </button>
          </div>

          <div className="grid gap-2.5 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-slate-300">
                拠点名称 *
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例: 京都基幹サーバルーム"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-slate-300">
                拠点種別
              </label>
              <select
                value={assetType}
                onChange={(e) => setAssetType(e.target.value as EnterpriseAssetType)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
              >
                {Object.entries(ASSET_TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-2.5 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-slate-300">
                所在区
              </label>
              <select
                value={wardName}
                onChange={(e) => setWardName(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
              >
                {KYOTO_WARDS.map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-slate-300">
                緯度 (Lat) *
              </label>
              <input
                type="text"
                required
                value={latStr}
                onChange={(e) => setLatOverride(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 font-mono text-xs text-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-slate-300">
                経度 (Lon) *
              </label>
              <input
                type="text"
                required
                value={lonStr}
                onChange={(e) => setLonOverride(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 font-mono text-xs text-white"
              />
            </div>
          </div>

          <div className="grid gap-2.5 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-slate-300">
                階数・建屋メモ
              </label>
              <input
                type="text"
                value={floorInfo}
                onChange={(e) => setFloorInfo(e.target.value)}
                placeholder="例: 本館3F 免震フロア"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-slate-300">
                非常電源持続時間 (h)
              </label>
              <input
                type="number"
                min={0}
                max={999}
                value={backupHoursStr}
                onChange={(e) => setBackupHoursStr(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-semibold text-slate-300">
              機密・共有レベル
            </label>
            <select
              value={confidentiality}
              onChange={(e) =>
                setConfidentiality(e.target.value as EnterpriseConfidentiality)
              }
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
            >
              {Object.entries(CONFIDENTIALITY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-semibold text-slate-300">
              設備メモ（非常対応手順等）
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="例: UPS+自家発72h、代替DCは山科側へフェイルオーバー"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
            />
          </div>

          <button
            type="submit"
            disabled={saving}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Firestoreへ暗号化保護保存
          </button>
        </form>
      )}

      {(firestoreError || assessError) && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-950/40 p-3 text-xs text-rose-200">
          {firestoreError || assessError}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-xs text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
          拠点台帳を読み込み中...
        </div>
      ) : assets.length === 0 ? (
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-6 text-center text-xs text-slate-400">
          <Server className="mx-auto mb-2 h-6 w-6 text-slate-500" />
          {userRole === "government"
            ? "現在、政府連携許可済みの企業重要拠点はありません。"
            : "登録済みの自社非公開拠点はまだありません。「非公開拠点を登録」からサーバー室やBCP本部を追加してください。"}
        </div>
      ) : (
        <div className="space-y-3">
          {assets.map((asset) => {
            const evalData = assessments[asset.id];
            const isGovShared = asset.confidentialityLevel === "gov_emergency_share";
            return (
              <div
                key={asset.id}
                className="rounded-xl border border-slate-800 bg-slate-900/80 p-3.5 text-xs transition hover:border-emerald-500/40"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Building2 className="h-4 w-4 text-emerald-400" />
                      <span className="font-bold text-white">{asset.name}</span>
                      <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300">
                        {ASSET_TYPE_LABELS[asset.assetType] || asset.assetType}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                      <span>{asset.wardName}</span>
                      {asset.floorInfo && <span>• {asset.floorInfo}</span>}
                      {asset.backupHours != null && (
                        <span>• 電源 {asset.backupHours}h</span>
                      )}
                      {userRole === "government" && asset.organizationName && (
                        <span className="text-amber-300">
                          • {asset.organizationName}
                        </span>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => onFocusAsset(asset)}
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-200 hover:bg-emerald-500/25"
                  >
                    <MapPin className="h-3 w-3" />
                    地図表示
                  </button>
                </div>

                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <span
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                      isGovShared
                        ? "border-amber-500/40 bg-amber-500/15 text-amber-200"
                        : "border-emerald-500/40 bg-emerald-500/15 text-emerald-200"
                    }`}
                  >
                    {isGovShared ? (
                      <>
                        <ShieldAlert className="h-3 w-3" />
                        災害連携のため政府機関へも共有
                      </>
                    ) : (
                      <>
                        <ShieldCheck className="h-3 w-3" />
                        自社のみ閲覧（完全秘匿）
                      </>
                    )}
                  </span>

                  {userRole === "enterprise" && asset.ownerUid === userUid && (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => void handleToggleShare(asset)}
                        className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-[10px] text-slate-300 hover:bg-slate-800"
                      >
                        {isGovShared ? "完全秘匿に戻す" : "緊急時のみ政府共有ON"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(asset)}
                        title="拠点を削除"
                        className="rounded-md border border-rose-500/30 bg-rose-950/40 p-1 text-rose-300 hover:bg-rose-900/50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                {asset.notes && (
                  <p className="mt-2 rounded-lg bg-slate-950/70 p-2 text-[11px] text-slate-300">
                    {asset.notes}
                  </p>
                )}

                {evalData && (
                  <div className="mt-2.5 space-y-1.5 rounded-lg border border-sky-500/25 bg-sky-950/25 p-2.5 text-[11px]">
                    <div className="flex flex-wrap items-center justify-between gap-2 font-semibold text-sky-200">
                      <span>
                        BCP安全スコア:{" "}
                        {evalData.safety_score != null
                          ? `${evalData.safety_score.toFixed(1)} 点`
                          : "—"}
                      </span>
                      {evalData.hazard && (
                        <span>
                          30年震度6弱+{" "}
                          {evalData.hazard.t30_i55_ps != null
                            ? `${(evalData.hazard.t30_i55_ps * 100).toFixed(1)}%`
                            : "—"}
                          （ARV {evalData.hazard.arv ?? "—"}）
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-3 text-slate-300">
                      <span>600m圏 通行止め: {evalData.nearby_road_closures_600m}件</span>
                      <span>600m圏 建物被害: {evalData.nearby_building_damage_600m}件</span>
                      {evalData.nearest_official_shelter && (
                        <span>
                          最寄り避難場所: {evalData.nearest_official_shelter.name}（
                          {evalData.nearest_official_shelter.distance_km}km）
                        </span>
                      )}
                    </div>
                    {evalData.alerts.length > 0 && (
                      <ul className="list-disc pl-4 text-amber-200">
                        {evalData.alerts.map((a) => (
                          <li key={a}>{a}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
