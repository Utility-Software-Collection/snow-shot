use anyhow::{Context, Result};
use log::{debug, error, info};
use reqwest::{Client, Method, StatusCode, Url};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebDavConfig {
    pub url: String,
    pub username: String,
    pub password: String,
    pub path_prefix: Option<String>,
}

pub struct WebDavService {
    client: Client,
    config: WebDavConfig,
}

impl WebDavService {
    pub fn new(config: WebDavConfig) -> Result<Self> {
        Url::parse(&config.url).context("Invalid WebDAV URL")?;

        Ok(Self {
            client: Client::new(),
            config,
        })
    }

    pub async fn upload_bytes(
        &self,
        data: &[u8],
        object_key: String,
        content_type: Option<String>,
    ) -> Result<String> {
        let full_key = if let Some(prefix) = &self.config.path_prefix {
            format!("{}{}", prefix, object_key)
        } else {
            object_key
        };

        if full_key.trim_matches('/').is_empty() {
            anyhow::bail!("WebDAV object key is empty");
        }

        info!("Start uploading data to WebDAV: {}", full_key);

        self.ensure_parent_collections(&full_key).await?;

        let url = self.build_url(&full_key)?;
        let content_type = content_type.unwrap_or_else(|| "application/octet-stream".to_string());
        debug!("WebDAV Content-Type: {}", content_type);

        let mut request = self
            .client
            .put(&url)
            .header("Content-Type", content_type)
            .body(data.to_vec());

        if !self.config.username.is_empty() || !self.config.password.is_empty() {
            request = request.basic_auth(&self.config.username, Some(&self.config.password));
        }

        let response = request
            .send()
            .await
            .context("Upload data to WebDAV failed")?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            error!("WebDAV upload failed, HTTP status code: {}", status);
            anyhow::bail!(
                "WebDAV upload failed, HTTP status code: {}, {}",
                status,
                text
            );
        }

        info!("Data uploaded to WebDAV successfully: {}", url);
        Ok(url)
    }

    async fn ensure_parent_collections(&self, key: &str) -> Result<()> {
        let parts = key
            .split('/')
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>();

        if parts.len() <= 1 {
            return Ok(());
        }

        let mkcol = Method::from_bytes(b"MKCOL").context("Create MKCOL method failed")?;
        for index in 1..parts.len() {
            let collection_key = parts[..index].join("/");
            let url = self.build_url(&collection_key)?;
            let mut request = self.client.request(mkcol.clone(), url);

            if !self.config.username.is_empty() || !self.config.password.is_empty() {
                request = request.basic_auth(&self.config.username, Some(&self.config.password));
            }

            let response = request
                .send()
                .await
                .context("Create WebDAV collection failed")?;
            let status = response.status();

            if status.is_success() || status == StatusCode::METHOD_NOT_ALLOWED {
                continue;
            }

            let text = response.text().await.unwrap_or_default();
            anyhow::bail!(
                "Create WebDAV collection failed, HTTP status code: {}, {}",
                status,
                text
            );
        }

        Ok(())
    }

    fn build_url(&self, key: &str) -> Result<String> {
        let mut url = Url::parse(&self.config.url).context("Invalid WebDAV URL")?;
        {
            let mut segments = url
                .path_segments_mut()
                .map_err(|_| anyhow::anyhow!("WebDAV URL cannot be a base URL"))?;
            for segment in key.split('/').filter(|segment| !segment.is_empty()) {
                segments.push(segment);
            }
        }

        Ok(url.to_string())
    }
}
