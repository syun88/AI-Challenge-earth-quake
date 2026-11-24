"""Shared constants, classification definitions, and verified official metadata for QuakeLens Japan."""

TARGET_MUNICIPALITY = {
    "code": "26100",
    "name": "京都市",
    "name_en": "Kyoto City",
    "plateau_package_id": "plateau-26100-kyoto-shi-2025",
    "center": [135.7588, 34.9858],  # [lon, lat]
    "default_zoom": 12,
    "metric_crs": "EPSG:6674",  # JGD2011 / Japan Plane Rectangular CS VI (Kyoto)
    "storage_crs": "EPSG:4326",
}

WARD_NAMES = {
    "26101": "北区",
    "26102": "上京区",
    "26103": "左京区",
    "26104": "中京区",
    "26105": "東山区",
    "26106": "下京区",
    "26107": "南区",
    "26108": "右京区",
    "26109": "伏見区",
    "26110": "山科区",
    "26111": "西京区",
}

KYOTO_WARDS = list(WARD_NAMES.values())

WARD_CENTERS = {
    "京都市全域": {"lon": 135.7588, "lat": 34.9858},
    "北区": {"lon": 135.7450, "lat": 35.0480},
    "上京区": {"lon": 135.7560, "lat": 35.0290},
    "左京区": {"lon": 135.7880, "lat": 35.0450},
    "中京区": {"lon": 135.7510, "lat": 35.0100},
    "東山区": {"lon": 135.7760, "lat": 34.9960},
    "下京区": {"lon": 135.7530, "lat": 34.9890},
    "南区": {"lon": 135.7360, "lat": 34.9710},
    "右京区": {"lon": 135.7100, "lat": 35.0150},
    "伏見区": {"lon": 135.7610, "lat": 34.9360},
    "山科区": {"lon": 135.8140, "lat": 34.9850},
    "西京区": {"lon": 135.6910, "lat": 34.9770},
}

REPORT_CATEGORY_LABELS = {
    "building_damage": "建物の損傷・倒壊",
    "road_blocked": "道路の通行止め・損壊",
    "shelter_status": "避難所の状況",
    "rescue_support": "救助・支援の必要性",
    "other_disaster": "その他の災害情報",
}

REPORT_SEVERITY_LABELS = {
    "critical": "緊急・重大",
    "high": "警戒・大",
    "moderate": "注意・中",
    "info": "情報共有",
}

VERIFICATION_STATUS_LABELS = {
    "unverified": "未確認（市民報告）",
    "verified": "確認済（現地・複数照合）",
    "official": "公式発表（公的機関）",
    "demo_sample": "訓練用サンプル",
}

ROUTE_SIMULATION_DISCLAIMER = (
    "【訓練・研究用シミュレーション】主要幹線道路を簡略化したネットワーク上の経路計算です。"
    "実際の道路幅員・橋梁耐力・二次災害リスクや公式の交通規制は反映されていないため、"
    "実災害時の避難・救助ルートとしては使用せず、自治体・警察・公式交通情報に従ってください。"
)

AGE_CATEGORY_LABELS = {
    "pre_1981": "1981年以前",
    "1982_2000": "1982〜2000年",
    "post_2001": "2001年以降",
    "unknown": "建築年不明",
}

AGE_CATEGORY_ORDER = ["pre_1981", "1982_2000", "post_2001", "unknown"]

RESIDENTIAL_USAGE_CODES = {"411", "412", "413", "414", "415"}
NON_RESIDENTIAL_USAGE_CODES = {
    "401", "402", "403", "404",
    "421", "422", "431", "441",
    "451", "452", "453", "454",
}

USAGE_GROUP_LABELS = {
    "residential": "住宅系",
    "non_residential": "非住宅（業務・商業・公共等）",
    "unknown": "用途不明",
}

# Standard J-SHIS probabilistic seismic hazard brackets for T30_I55_PS
# (30-year probability of JMA seismic intensity 6-lower or greater)
HAZARD_TIER_LABELS = {
    "very_high": "26%以上（J-SHIS区分: 高）",
    "elevated": "6%〜26%未満（J-SHIS区分: やや高）",
    "moderate": "3%〜6%未満（J-SHIS区分: 中）",
    "low": "3%未満（J-SHIS区分: 低）",
    "unknown": "ハザード値不明",
}

HAZARD_TIER_ORDER = ["very_high", "elevated", "moderate", "low", "unknown"]


def classify_age_category(year: int | None) -> str:
    """Classify construction year into four transparent buckets without estimating missing values."""
    if year is None:
        return "unknown"
    if year <= 1981:
        return "pre_1981"
    if year <= 2000:
        return "1982_2000"
    return "post_2001"


def classify_hazard_tier(prob_t30_i55: float | None) -> str:
    """Classify J-SHIS 30-year probability of Shindo 6-lower+ using J-SHIS official brackets."""
    if prob_t30_i55 is None:
        return "unknown"
    if prob_t30_i55 >= 0.26:
        return "very_high"
    if prob_t30_i55 >= 0.06:
        return "elevated"
    if prob_t30_i55 >= 0.03:
        return "moderate"
    return "low"


DATA_SOURCES = [
    {
        "id": "plateau",
        "name": "Project PLATEAU 3D都市モデル 京都市（2025年度）",
        "provider": "国土交通省（MLIT）/ 京都市",
        "reference_year": "2025年度（調査年 2025年）",
        "license": "PLATEAU Site Policy「3. 著作権について」（商用利用含め無償利用可・出典明記）",
        "url": "https://www.geospatial.jp/ckan/dataset/plateau-26100-kyoto-shi-2025",
        "notes": "建築年（bldg:yearOfConstruction）は年単位のため、1981年・2000年建物の月日基準（6月1日施行）の厳密判定には使用できません。",
    },
    {
        "id": "jshis",
        "name": "J-SHIS 地震ハザードステーション Web API（2024年版 / 表層地盤 V4）",
        "provider": "国立研究開発法人 防災科学技術研究所（NIED）",
        "reference_year": "2024年版（Y2024・平均ケース AVR・全地震 TTL_MTTL）/ 表層地盤 V4",
        "license": "J-SHIS 利用規約（加工・編集成果物の頒布可、出典明記必須）",
        "url": "https://www.j-shis.bosai.go.jp/api-list",
        "notes": "今後30年間に震度6弱以上の揺れに見舞われる確率（T30_I55_PS）等を表示。建物の倒壊確率やリアルタイム地震予測ではありません。",
    },
    {
        "id": "jma",
        "name": "気象庁 地震情報（震源・震度情報 JSON）",
        "provider": "気象庁（JMA）",
        "reference_year": "リアルタイム・直近履歴",
        "license": "気象庁ホームページ利用規約（出典明記）",
        "url": "https://www.jma.go.jp/bosai/quake/data/list.json",
        "notes": "参考情報として直近の地震発生履歴を表示します。",
    },
    {
        "id": "gsi",
        "name": "国土地理院 地理院タイル（淡色地図・指定緊急避難場所）",
        "provider": "国土地理院（GSI）",
        "reference_year": "最新",
        "license": "国土地理院コンテンツ利用規約（出典明記）",
        "url": "https://maps.gsi.go.jp/development/ichiran.html",
        "notes": "背景地図タイルおよび京都市の指定緊急避難場所（skhb01〜07）データを使用しています。",
    },
    {
        "id": "kyoto_hazard",
        "name": "京都市防災ポータルサイト 地震ハザードマップ",
        "provider": "京都市（行財政局防災危機管理室）",
        "reference_year": "令和8年（2026年）公開版",
        "license": "京都市防災ポータルサイト公式リンク参照",
        "url": "https://www.bousai.city.kyoto.lg.jp/0000000196.html",
        "notes": "各行政区の地震ハザードマップ（PDF）および京都市Web版ハザードマップへの公式案内として参照しています。",
    },
]

OFFICIAL_RETROFIT_PROGRAMS = [
    {
        "title": "木造住宅及び京町家の耐震診断士派遣事業（無料耐震診断）",
        "organization": "京都市（都市計画局 建築指導部 建築安全推進課）",
        "summary": "京都市内の木造住宅（昭和56年5月31日以前着工等）や京町家（昭和25年11月22日以前着工等）を対象に、登録耐震診断士を無料で派遣する制度です（対象要件・申込期間あり）。",
        "url": "https://www.city.kyoto.lg.jp/tokei/page/0000119039.html",
    },
    {
        "title": "「まちの匠・ぷらす」京町家・木造住宅 耐震・防火改修支援事業",
        "organization": "京都市（都市計画局 建築指導部 建築安全推進課）",
        "summary": "昭和56年5月31日以前着工の木造住宅や京町家を対象とした、耐震改修工事・防火改修工事等の補助制度です。",
        "url": "https://www.city.kyoto.lg.jp/tokei/page/0000235294.html",
    },
    {
        "title": "京（みやこ）安心すまいセンター「木造住宅の耐震化助成制度」",
        "organization": "公益財団法人 京都市住宅供給公社（京安心すまいセンター）",
        "summary": "京都市の耐震診断・耐震改修支援制度や相談窓口、耐震専門家派遣の総合案内ページです。",
        "url": "https://www.kyoto-jkosha.or.jp/sumai/taishin/shindan/",
    },
    {
        "title": "京都市 建築安全推進課（耐震化・宅地耐震化等）",
        "organization": "京都市 都市計画局",
        "summary": "大規模盛土造成地マップや建築物の耐震化に関する公式窓口ページです。",
        "url": "https://www.city.kyoto.lg.jp/tokei/soshiki/9-2-4-0-0.html",
    },
]

KYOTO_HAZARD_MAP_PORTAL = {
    "earthquake_page_url": "https://www.bousai.city.kyoto.lg.jp/0000000196.html",
    "web_hazard_map_url": "https://www.bousaimap.city.kyoto.lg.jp/Top",
    "portal_home_url": "https://www.bousai.city.kyoto.lg.jp/",
}

KYOTO_WARD_HAZARD_MAPS: dict[str, dict[str, str]] = {
    "北区": {
        "map_pdf": "https://www.bousai.city.kyoto.lg.jp/cmsfiles/contents/0000000/196/01EA_kita_map_jishin_260210_web.pdf",
        "info_pdf": "https://www.bousai.city.kyoto.lg.jp/cmsfiles/contents/0000000/196/01EB_kita_joho_jishin_260616_web.pdf",
    },
    "上京区": {
        "map_pdf": "https://www.bousai.city.kyoto.lg.jp/cmsfiles/contents/0000000/196/02EA_kamigyo_map_jishin_260210_web.pdf",
        "info_pdf": "https://www.bousai.city.kyoto.lg.jp/cmsfiles/contents/0000000/196/02EB_kamigyo_joho_jishin_260616_web.pdf",
    },
    "左京区": {
        "map_pdf": "https://www.bousai.city.kyoto.lg.jp/cmsfiles/contents/0000000/196/03EA_sakyou_map_jishin_260210_web.pdf",
        "info_pdf": "https://www.bousai.city.kyoto.lg.jp/cmsfiles/contents/0000000/196/03EB_sakyo_joho_jishin_260616_web.pdf",
    },
    "中京区": {
        "map_pdf": "https://www.bousai.city.kyoto.lg.jp/cmsfiles/contents/0000000/196/04EA_nakagyo_map_jishin_260210_web.pdf",
        "info_pdf": "https://www.bousai.city.kyoto.lg.jp/cmsfiles/contents/0000000/196/04EB_nakagyo_joho_jishin_260616_web.pdf",
    },
    "東山区": {
        "map_pdf": "https://www.bousai.city.kyoto.lg.jp/cmsfiles/contents/0000000/196/05EA_higashi_map_jishin_260210_web.pdf",
        "info_pdf": "https://www.bousai.city.kyoto.lg.jp/cmsfiles/contents/0000000/196/05EB_higashiyama_joho_jishin_260616_web.pdf",
    },
    "山科区": {
        "map_pdf": "https://www.bousai.city.kyoto.lg.jp/cmsfiles/contents/0000000/196/06EA_yamashina_map_jishin_260210_web.pdf",
        "info_pdf": "https://www.bousai.city.kyoto.lg.jp/cmsfiles/contents/0000000/196/06EB_yamashina_joho_jishin_260616_web.pdf",
    },
    "下京区": {
        "map_pdf": "https://www.bousai.city.kyoto.lg.jp/cmsfiles/contents/0000000/196/07EA_shimogyo_map_jishin_260210_web.pdf",
        "info_pdf": "https://www.bousai.city.kyoto.lg.jp/cmsfiles/contents/0000000/196/07EB_shimogyo_joho_jishin_260616_web.pdf",
    },
    "南区": {
        "map_pdf": "https://www.bousai.city.kyoto.lg.jp/cmsfiles/contents/0000000/196/08EA_minami_map_jishin_260210_web.pdf",
        "info_pdf": "https://www.bousai.city.kyoto.lg.jp/cmsfiles/contents/0000000/196/08EB_minami_joho_jishin_260616_web.pdf",
    },
    "右京区": {
        "map_pdf": "https://www.bousai.city.kyoto.lg.jp/cmsfiles/contents/0000000/196/09_1EA_ukyo_map_jishin_260210_web.pdf",
        "info_pdf": "https://www.bousai.city.kyoto.lg.jp/cmsfiles/contents/0000000/196/09_1EB_ukyo_joho_jishin_260616_web.pdf",
        "keihoku_map_pdf": "https://www.bousai.city.kyoto.lg.jp/cmsfiles/contents/0000000/196/09_2EA_keihoku_map_jishin_260210_web.pdf",
        "keihoku_info_pdf": "https://www.bousai.city.kyoto.lg.jp/cmsfiles/contents/0000000/196/09_2EB_keihoku_joho_jishin_260616_web.pdf",
    },
    "西京区": {
        "map_pdf": "https://www.bousai.city.kyoto.lg.jp/cmsfiles/contents/0000000/196/10EA_nishikyou_map_jishin_260210_web.pdf",
        "info_pdf": "https://www.bousai.city.kyoto.lg.jp/cmsfiles/contents/0000000/196/10EB_nishikyo_joho_jishin_260616_web.pdf",
    },
    "伏見区": {
        "map_pdf": "https://www.bousai.city.kyoto.lg.jp/cmsfiles/contents/0000000/196/11EA_fushimi_map_jishin_260210_web.pdf",
        "info_pdf": "https://www.bousai.city.kyoto.lg.jp/cmsfiles/contents/0000000/196/11EB_fushimi_joho_jishin_260616_web.pdf",
    },
}
