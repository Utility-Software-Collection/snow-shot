pub mod s3;
pub mod webdav;

// 重新导出常用类型
pub use s3::{S3Config, S3Service};
pub use webdav::{WebDavConfig, WebDavService};
