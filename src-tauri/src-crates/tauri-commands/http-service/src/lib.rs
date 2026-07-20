use snow_shot_http_services::{S3Config, S3Service, WebDavConfig, WebDavService};

pub async fn upload_to_s3(
    config: S3Config,
    data: &[u8],
    filename: String,
    content_type: Option<String>,
) -> Result<String, String> {
    let service = S3Service::new(config).await.map_err(|e| e.to_string())?;

    let url = service
        .upload_bytes(data, filename, content_type)
        .await
        .map_err(|e| e.to_string())?;

    Ok(url)
}

pub async fn upload_to_webdav(
    url: String,
    username: String,
    password: String,
    path_prefix: Option<String>,
    data: &[u8],
    filename: String,
    content_type: Option<String>,
) -> Result<String, String> {
    let config = WebDavConfig {
        url,
        username,
        password,
        path_prefix,
    };

    let service = WebDavService::new(config).map_err(|e| e.to_string())?;

    let url = service
        .upload_bytes(data, filename, content_type)
        .await
        .map_err(|e| e.to_string())?;

    Ok(url)
}
