use pam_codec::{PamInfo, decode_pam, encode_pam};
use std::io::Cursor;
use wasm_bindgen::prelude::*;

fn js_error(error: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&error.to_string())
}

#[wasm_bindgen(js_name = decodePam)]
pub fn decode_pam_wasm(bytes: &[u8]) -> Result<JsValue, JsValue> {
    let mut cursor = Cursor::new(bytes);
    let pam = decode_pam(&mut cursor).map_err(js_error)?;
    serde_wasm_bindgen::to_value(&pam).map_err(js_error)
}

#[wasm_bindgen(js_name = encodePam)]
pub fn encode_pam_wasm(value: JsValue) -> Result<Vec<u8>, JsValue> {
    let pam: PamInfo = serde_wasm_bindgen::from_value(value).map_err(js_error)?;
    let mut bytes = Vec::new();
    encode_pam(&pam, &mut bytes).map_err(js_error)?;
    Ok(bytes)
}

#[wasm_bindgen(js_name = pamToJson)]
pub fn pam_to_json_wasm(value: JsValue) -> Result<String, JsValue> {
    let pam: PamInfo = serde_wasm_bindgen::from_value(value).map_err(js_error)?;
    serde_json::to_string_pretty(&pam).map_err(js_error)
}
