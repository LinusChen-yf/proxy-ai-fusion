use super::web_server::AppState;
use axum::{
    extract::{ws::WebSocketUpgrade, State},
    response::IntoResponse,
};

pub async fn websocket_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| async move {
        state.realtime_hub.handle_connection(socket).await;
    })
}
