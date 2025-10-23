use super::UsageMetrics;
use serde_json::Value;

pub fn extract_usage_from_response(service: &str, response_body: &[u8]) -> Option<UsageMetrics> {
    let body_str = std::str::from_utf8(response_body).ok()?;
    
    // Try to parse as JSON
    if let Ok(json) = serde_json::from_str::<Value>(body_str) {
        match service {
            "claude" => extract_claude_usage(&json),
            "codex" => extract_openai_usage(&json),
            _ => None,
        }
    } else {
        // Try to extract from SSE stream
        extract_from_sse_stream(service, body_str)
    }
}

fn extract_claude_usage(json: &Value) -> Option<UsageMetrics> {
    let usage = json.get("usage")?;
    
    let input_tokens = usage.get("input_tokens")?.as_u64().unwrap_or(0);
    let output_tokens = usage.get("output_tokens")?.as_u64().unwrap_or(0);
    let total_tokens = input_tokens + output_tokens;
    
    let model = json.get("model")
        .and_then(|m| m.as_str())
        .unwrap_or("unknown")
        .to_string();

    Some(UsageMetrics {
        prompt_tokens: input_tokens,
        completion_tokens: output_tokens,
        total_tokens,
        model,
    })
}

fn extract_openai_usage(json: &Value) -> Option<UsageMetrics> {
    let usage = json.get("usage")?;
    
    let prompt_tokens = usage.get("prompt_tokens")?.as_u64().unwrap_or(0);
    let completion_tokens = usage.get("completion_tokens")?.as_u64().unwrap_or(0);
    let total_tokens = usage.get("total_tokens")?.as_u64().unwrap_or(prompt_tokens + completion_tokens);
    
    let model = json.get("model")
        .and_then(|m| m.as_str())
        .unwrap_or("unknown")
        .to_string();

    Some(UsageMetrics {
        prompt_tokens,
        completion_tokens,
        total_tokens,
        model,
    })
}

fn extract_from_sse_stream(service: &str, stream: &str) -> Option<UsageMetrics> {
    // Parse SSE events
    let mut total_usage = UsageMetrics::default();
    let mut found_usage = false;

    for line in stream.lines() {
        if line.starts_with("data: ") {
            let data = &line[6..];
            if data == "[DONE]" {
                continue;
            }
            
            if let Ok(json) = serde_json::from_str::<Value>(data) {
                if let Some(usage) = match service {
                    "claude" => extract_claude_usage(&json),
                    "codex" => extract_openai_usage(&json),
                    _ => None,
                } {
                    // Merge usage metrics
                    total_usage.prompt_tokens += usage.prompt_tokens;
                    total_usage.completion_tokens += usage.completion_tokens;
                    total_usage.total_tokens += usage.total_tokens;
                    if !usage.model.is_empty() {
                        total_usage.model = usage.model;
                    }
                    found_usage = true;
                }
            }
        }
    }

    if found_usage {
        Some(total_usage)
    } else {
        None
    }
}
