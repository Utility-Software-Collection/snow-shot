use image::{DynamicImage, GrayImage, imageops::FilterType};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(PartialEq, Serialize, Deserialize, Debug, Clone, Copy)]
pub enum ScrollDirection {
    /// 垂直滚动
    Vertical = 0,
    /// 水平滚动
    Horizontal = 1,
}

#[derive(PartialEq, Serialize, Deserialize, Debug, Clone, Copy)]
pub enum ScrollImageList {
    /// 上图片列表
    Top = 0,
    /// 下图片列表
    Bottom = 1,
}

#[derive(Debug, Clone, Copy)]
pub struct CropRegion {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

impl CropRegion {
    pub fn new(x: u32, y: u32, width: u32, height: u32) -> Self {
        Self {
            x,
            y,
            width,
            height,
        }
    }
}

pub struct ScrollImage {
    pub image: image::DynamicImage,
    pub overlay_size: i32,
}

struct CapturedFrame {
    image: DynamicImage,
    position: i32,
}

#[derive(Debug, Clone, Copy)]
struct ShiftMatch {
    direction: ScrollImageList,
    delta: i32,
}

pub struct ScrollScreenshotService {
    /// 滚动截图列表（上或左）
    pub top_image_list: Vec<ScrollImage>,
    /// 滚动截图列表（下或右）
    pub bottom_image_list: Vec<ScrollImage>,
    /// 当前方向
    pub current_direction: ScrollDirection,
    /// 图片宽度
    pub image_width: u32,
    /// 图片高度
    pub image_height: u32,
    /// 上图片尺寸（方向边）
    pub top_image_size: i32,
    /// 上图片索引尺寸（方向边）
    pub top_image_index_size: i32,
    /// 下图片尺寸（方向边）
    pub bottom_image_size: i32,
    /// 下图片索引尺寸（方向边）
    pub bottom_image_index_size: i32,
    /// 图片缩放
    pub image_scale: f32,
    /// 特征点阈值；新逻辑中作为平均像素差容忍度
    pub corner_threshold: u8,
    /// 描述符块大小；新逻辑中作为匹配采样密度
    pub descriptor_patch_size: usize,
    /// 最大单次滚动变化量
    pub min_size_delta: i32,
    /// 缩放的图片宽度
    pub image_dst_width: u32,
    /// 缩放的图片高度
    pub image_dst_height: u32,
    /// 滚动方向的图片尺寸
    pub image_scroll_side_size: i32,
    /// 是否尝试回滚
    pub try_rollback: bool,
    /// 采样率
    pub sample_rate: f32,
    /// 最小采样尺寸
    pub min_sample_size: u32,
    /// 最大采样尺寸
    pub max_sample_size: u32,
    last_image: Option<DynamicImage>,
    last_gray_image: Option<GrayImage>,
    last_position: i32,
    captured_frames: Vec<CapturedFrame>,
}

impl Default for ScrollScreenshotService {
    fn default() -> Self {
        Self::new()
    }
}

impl ScrollScreenshotService {
    pub fn new() -> Self {
        Self {
            top_image_list: vec![],
            bottom_image_list: vec![],
            current_direction: ScrollDirection::Vertical,
            image_width: 0,
            image_height: 0,
            top_image_size: 0,
            top_image_index_size: 0,
            bottom_image_size: 0,
            bottom_image_index_size: 0,
            image_scale: 1.0,
            corner_threshold: 24,
            descriptor_patch_size: 28,
            min_size_delta: 0,
            image_dst_width: 0,
            image_dst_height: 0,
            image_scroll_side_size: 0,
            try_rollback: true,
            sample_rate: 1.0,
            min_sample_size: 128,
            max_sample_size: 128,
            last_image: None,
            last_gray_image: None,
            last_position: 0,
            captured_frames: vec![],
        }
    }

    pub fn clear(&mut self) {
        self.top_image_list.clear();
        self.bottom_image_list.clear();
        self.top_image_size = 0;
        self.top_image_index_size = 0;
        self.bottom_image_size = 0;
        self.bottom_image_index_size = 0;
        self.last_image = None;
        self.last_gray_image = None;
        self.last_position = 0;
        self.captured_frames.clear();
    }

    // Parameters mirror the user-configurable scroll capture options.
    #[allow(clippy::too_many_arguments)]
    pub fn init(
        &mut self,
        direction: ScrollDirection,
        sample_rate: f32,
        min_sample_size: u32,
        max_sample_size: u32,
        corner_threshold: u8,
        descriptor_patch_size: usize,
        min_size_delta: i32,
        try_rollback: bool,
    ) {
        self.clear();
        self.current_direction = direction;
        self.image_width = 0;
        self.image_height = 0;
        self.image_scale = 1.0;
        self.image_dst_width = 0;
        self.image_dst_height = 0;
        self.image_scroll_side_size = 0;
        self.corner_threshold = corner_threshold.max(1);
        self.descriptor_patch_size = descriptor_patch_size.clamp(8, 128);
        self.min_size_delta = min_size_delta.max(0);
        self.try_rollback = try_rollback;
        self.sample_rate = sample_rate.clamp(0.1, 1.0);
        self.min_sample_size = min_sample_size;
        self.max_sample_size = max_sample_size.max(min_sample_size).max(1);
    }

    pub fn init_image_size(&mut self, image_width: u32, image_height: u32) {
        self.image_width = image_width;
        self.image_height = image_height;

        let image_scale_side_size = if self.current_direction == ScrollDirection::Vertical {
            image_width as f32
        } else {
            image_height as f32
        };

        let target_side_size = (image_scale_side_size * self.sample_rate)
            .min(self.max_sample_size as f32)
            .max(self.min_sample_size as f32);

        self.image_scale = (target_side_size / image_scale_side_size).min(1.0);

        if self.current_direction == ScrollDirection::Vertical {
            self.image_dst_width = (image_width as f32 * self.image_scale).round().max(1.0) as u32;
            self.image_dst_height = image_height;
        } else {
            self.image_dst_width = image_width;
            self.image_dst_height =
                (image_height as f32 * self.image_scale).round().max(1.0) as u32;
        }

        self.image_scroll_side_size = if self.current_direction == ScrollDirection::Vertical {
            self.image_height as i32
        } else {
            self.image_width as i32
        };
    }

    fn normalize_image(image: DynamicImage) -> DynamicImage {
        DynamicImage::ImageRgba8(image.to_rgba8())
    }

    fn get_gray_image(&self, image: &DynamicImage) -> GrayImage {
        let gray_image = image.to_luma8();

        if self.image_scale >= 1.0 {
            return gray_image;
        }

        image::imageops::resize(
            &gray_image,
            self.image_dst_width,
            self.image_dst_height,
            FilterType::Triangle,
        )
    }

    fn get_scroll_side_size(&self) -> i32 {
        if self.current_direction == ScrollDirection::Vertical {
            self.image_height as i32
        } else {
            self.image_width as i32
        }
    }

    fn get_cross_side_size(&self, image: &GrayImage) -> u32 {
        if self.current_direction == ScrollDirection::Vertical {
            image.width()
        } else {
            image.height()
        }
    }

    fn get_match_error_threshold(&self) -> f32 {
        self.corner_threshold as f32
    }

    fn get_max_delta(&self) -> i32 {
        let side_size = self.get_scroll_side_size();
        if side_size <= 1 {
            return 0;
        }

        let configured_max_delta = if self.min_size_delta > 0 {
            self.min_size_delta
        } else {
            (side_size as f32 * 0.8).round() as i32
        };

        configured_max_delta.clamp(1, side_size - 1)
    }

    fn scaled_index(index: usize, count: usize, size: u32) -> u32 {
        if count <= 1 || size <= 1 {
            0
        } else {
            ((index as u64 * (size - 1) as u64) / (count - 1) as u64) as u32
        }
    }

    fn get_pixel(image: &GrayImage, direction: ScrollDirection, along: u32, cross: u32) -> u8 {
        let (x, y) = if direction == ScrollDirection::Vertical {
            (cross, along)
        } else {
            (along, cross)
        };

        image.get_pixel(x, y)[0]
    }

    fn score_delta(
        &self,
        previous: &GrayImage,
        current: &GrayImage,
        scroll_image_list: ScrollImageList,
        delta: i32,
    ) -> f32 {
        let side_size = self.get_scroll_side_size() as u32;
        let cross_size = self
            .get_cross_side_size(previous)
            .min(self.get_cross_side_size(current));
        let delta = delta.max(0) as u32;

        if delta >= side_size || cross_size == 0 {
            return f32::INFINITY;
        }

        let overlap_size = side_size - delta;
        let preferred_edge_trim = (side_size / 10).min(120);
        let edge_trim = preferred_edge_trim.min(overlap_size.saturating_sub(1) / 2);
        let usable_overlap_size = overlap_size.saturating_sub(edge_trim * 2);
        if usable_overlap_size == 0 {
            return f32::INFINITY;
        }

        let cross_trim = (cross_size / 50).min(8);
        let usable_cross_size = cross_size.saturating_sub(cross_trim * 2);
        if usable_cross_size == 0 {
            return f32::INFINITY;
        }

        let sample_count = self.descriptor_patch_size;
        let along_samples = sample_count.min(usable_overlap_size as usize).max(1);
        let cross_samples = sample_count.min(usable_cross_size as usize).max(1);
        let direction = self.current_direction;

        let total_diff: u64 = (0..along_samples)
            .into_par_iter()
            .map(|along_index| {
                let overlap_pos =
                    edge_trim + Self::scaled_index(along_index, along_samples, usable_overlap_size);

                let (previous_along, current_along) = match scroll_image_list {
                    ScrollImageList::Bottom => (delta + overlap_pos, overlap_pos),
                    ScrollImageList::Top => (overlap_pos, delta + overlap_pos),
                };

                let mut row_diff = 0u64;
                for cross_index in 0..cross_samples {
                    let cross_pos = cross_trim
                        + Self::scaled_index(cross_index, cross_samples, usable_cross_size);
                    let previous_pixel =
                        Self::get_pixel(previous, direction, previous_along, cross_pos);
                    let current_pixel =
                        Self::get_pixel(current, direction, current_along, cross_pos);

                    row_diff += previous_pixel.abs_diff(current_pixel) as u64;
                }

                row_diff
            })
            .sum();

        total_diff as f32 / (along_samples * cross_samples) as f32
    }

    fn find_shift(
        &self,
        previous: &GrayImage,
        current: &GrayImage,
        scroll_image_list: ScrollImageList,
    ) -> Option<ShiftMatch> {
        let max_delta = self.get_max_delta();
        if max_delta <= 0 {
            return None;
        }

        let mut scores: Vec<(i32, f32)> = (0..=max_delta)
            .into_par_iter()
            .map(|delta| {
                (
                    delta,
                    self.score_delta(previous, current, scroll_image_list, delta),
                )
            })
            .collect();

        scores.sort_by(|(delta_a, score_a), (delta_b, score_b)| {
            score_a
                .partial_cmp(score_b)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| delta_a.cmp(delta_b))
        });

        let (mut best_delta, mut best_score) = *scores.first()?;
        if !best_score.is_finite() || best_score > self.get_match_error_threshold() {
            return None;
        }

        // Sticky headers, large solid backgrounds, and repeated card layouts can make
        // the zero-shift score deceptively good. If a non-zero shift is clearly
        // identifiable, prefer it so auto-scroll does not stop early.
        if best_delta == 0
            && let Some((non_zero_delta, non_zero_score)) = scores
                .iter()
                .filter(|(delta, score)| *delta > 2 && score.is_finite())
                .min_by(|(delta_a, score_a), (delta_b, score_b)| {
                    score_a
                        .partial_cmp(score_b)
                        .unwrap_or(std::cmp::Ordering::Equal)
                        .then_with(|| delta_a.cmp(delta_b))
                })
                .copied()
        {
            let non_zero_second_score = scores
                .iter()
                .filter(|(delta, _)| *delta > 2 && (delta - non_zero_delta).abs() > 2)
                .map(|(_, score)| *score)
                .fold(f32::INFINITY, f32::min);
            let non_zero_is_ambiguous = non_zero_second_score.is_finite()
                && non_zero_second_score <= self.get_match_error_threshold()
                && non_zero_second_score - non_zero_score < 0.25;

            if !non_zero_is_ambiguous
                && non_zero_score <= self.get_match_error_threshold()
                && (best_score > self.get_match_error_threshold()
                    || non_zero_score + 0.25 < best_score)
            {
                best_delta = non_zero_delta;
                best_score = non_zero_score;
            }
        }

        let second_score = scores
            .iter()
            .find(|(delta, _)| (delta - best_delta).abs() > 2)
            .map(|(_, score)| *score)
            .unwrap_or(f32::INFINITY);

        if best_delta > 0
            && second_score.is_finite()
            && second_score <= self.get_match_error_threshold()
            && second_score - best_score < 0.25
        {
            return None;
        }

        Some(ShiftMatch {
            direction: scroll_image_list,
            delta: best_delta,
        })
    }

    fn find_best_shift(
        &self,
        previous: &GrayImage,
        current: &GrayImage,
        preferred_scroll_image_list: ScrollImageList,
    ) -> Option<ShiftMatch> {
        let preferred_match = self.find_shift(previous, current, preferred_scroll_image_list);
        if preferred_match
            .as_ref()
            .map(|result| result.delta == 0)
            .unwrap_or(false)
        {
            return preferred_match;
        }

        if !self.try_rollback {
            return preferred_match;
        }

        let rollback_scroll_image_list = if preferred_scroll_image_list == ScrollImageList::Top {
            ScrollImageList::Bottom
        } else {
            ScrollImageList::Top
        };

        preferred_match.or_else(|| self.find_shift(previous, current, rollback_scroll_image_list))
    }

    fn get_crop_region(&self, scroll_image_list: ScrollImageList, unique_size: i32) -> CropRegion {
        let unique_size = unique_size.max(0) as u32;

        match (self.current_direction, scroll_image_list) {
            (ScrollDirection::Vertical, ScrollImageList::Top) => {
                CropRegion::new(0, 0, self.image_width, unique_size)
            }
            (ScrollDirection::Vertical, ScrollImageList::Bottom) => CropRegion::new(
                0,
                self.image_height.saturating_sub(unique_size),
                self.image_width,
                unique_size,
            ),
            (ScrollDirection::Horizontal, ScrollImageList::Top) => {
                CropRegion::new(0, 0, unique_size, self.image_height)
            }
            (ScrollDirection::Horizontal, ScrollImageList::Bottom) => CropRegion::new(
                self.image_width.saturating_sub(unique_size),
                0,
                unique_size,
                self.image_height,
            ),
        }
    }

    fn push_initial_image(
        &mut self,
        image: DynamicImage,
        gray_image: GrayImage,
    ) -> (i32, Option<ScrollImageList>) {
        let edge_position = self.get_scroll_side_size();
        self.bottom_image_size = edge_position;
        self.bottom_image_index_size = edge_position;
        self.bottom_image_list.push(ScrollImage {
            image: image.clone(),
            overlay_size: 0,
        });
        self.last_image = Some(image);
        self.last_gray_image = Some(gray_image);
        self.last_position = 0;
        self.captured_frames.push(CapturedFrame {
            image: self.last_image.as_ref().unwrap().clone(),
            position: 0,
        });

        (edge_position, Some(ScrollImageList::Bottom))
    }

    fn push_unique_image(
        &mut self,
        image: &DynamicImage,
        scroll_image_list: ScrollImageList,
        unique_size: i32,
    ) -> Option<ScrollImageList> {
        if unique_size <= 0 {
            return None;
        }

        let crop_region = self.get_crop_region(scroll_image_list, unique_size);
        if crop_region.width == 0 || crop_region.height == 0 {
            return None;
        }

        let scroll_image = ScrollImage {
            image: image.crop_imm(
                crop_region.x,
                crop_region.y,
                crop_region.width,
                crop_region.height,
            ),
            overlay_size: 0,
        };

        if scroll_image_list == ScrollImageList::Bottom {
            self.bottom_image_list.push(scroll_image);
            self.bottom_image_size += unique_size;
            self.bottom_image_index_size = self.bottom_image_size;
        } else {
            self.top_image_list.push(scroll_image);
            self.top_image_size += unique_size;
            self.top_image_index_size = self.top_image_size;
        }

        Some(scroll_image_list)
    }

    pub fn handle_image(
        &mut self,
        image: DynamicImage,
        scroll_image_list: ScrollImageList,
    ) -> (
        Option<(i32, Option<ScrollImageList>)>,
        bool,
        ScrollImageList,
    ) {
        let image = Self::normalize_image(image);
        let image_width = image.width();
        let image_height = image.height();

        if self.image_width == 0 || self.image_height == 0 {
            // 在首次处理图片时初始化图片尺寸
            // 因为在 macOS 下，截图使用的是逻辑像素，和物理像素不一样
            self.init_image_size(image_width, image_height);
        } else if image_width != self.image_width || image_height != self.image_height {
            return (None, false, scroll_image_list);
        }

        let gray_image = self.get_gray_image(&image);

        if self.last_gray_image.is_none() {
            let initial_result = self.push_initial_image(image, gray_image);
            return (Some(initial_result), false, ScrollImageList::Bottom);
        }

        let previous_gray_image = self.last_gray_image.as_ref().unwrap();
        let shift_match =
            match self.find_best_shift(previous_gray_image, &gray_image, scroll_image_list) {
                Some(shift_match) => shift_match,
                None => return (None, false, scroll_image_list),
            };

        if shift_match.delta == 0 {
            self.last_image = Some(image);
            self.last_gray_image = Some(gray_image);
            return (None, true, shift_match.direction);
        }

        let side_size = self.get_scroll_side_size();
        let known_start = -self.top_image_size;
        let known_end = self.bottom_image_size;

        let new_position = if shift_match.direction == ScrollImageList::Bottom {
            self.last_position + shift_match.delta
        } else {
            self.last_position - shift_match.delta
        };

        let edge_position;
        let pushed_image_list;

        if shift_match.direction == ScrollImageList::Bottom {
            edge_position = new_position + side_size;
            let unique_size = (edge_position - known_end).clamp(0, side_size);
            pushed_image_list =
                self.push_unique_image(&image, ScrollImageList::Bottom, unique_size);
        } else {
            edge_position = new_position;
            let unique_size = (known_start - new_position).clamp(0, side_size);
            pushed_image_list = self.push_unique_image(&image, ScrollImageList::Top, unique_size);
        }

        self.last_image = Some(image);
        self.last_gray_image = Some(gray_image);
        self.last_position = new_position;
        self.captured_frames.push(CapturedFrame {
            image: self.last_image.as_ref().unwrap().clone(),
            position: new_position,
        });

        (
            Some((edge_position, pushed_image_list)),
            false,
            shift_match.direction,
        )
    }

    fn export_from_frames(
        &self,
        total_width: usize,
        total_height: usize,
        channel_count: usize,
    ) -> Option<Vec<u8>> {
        if self.captured_frames.is_empty() {
            return None;
        }

        let side_size = self.get_scroll_side_size();
        if side_size <= 0 {
            return None;
        }

        let final_start = -self.top_image_size;
        let final_end = self.bottom_image_size;
        let safe_margin = (side_size / 10).max(0).min(side_size / 3);
        let mut final_image = vec![0; total_width * total_height * channel_count];
        let mut frames = self.captured_frames.iter().collect::<Vec<_>>();
        frames.sort_by_key(|frame| frame.position);

        for frame in frames {
            let mut source_start = (final_start - frame.position).max(0);
            let mut source_end = (final_end - frame.position).min(side_size);

            if source_start >= source_end {
                continue;
            }

            if frame.position > final_start {
                source_start = source_start.max(safe_margin);
            }
            if frame.position + side_size < final_end {
                source_end = source_end.min(side_size - safe_margin);
            }

            if source_start >= source_end {
                continue;
            }

            let crop_size = (source_end - source_start) as u32;
            let crop_image;
            let (offset_x, offset_y) = if self.current_direction == ScrollDirection::Vertical {
                crop_image =
                    frame
                        .image
                        .crop_imm(0, source_start as u32, self.image_width, crop_size);
                (0, (frame.position + source_start - final_start) as usize)
            } else {
                crop_image =
                    frame
                        .image
                        .crop_imm(source_start as u32, 0, crop_size, self.image_height);
                ((frame.position + source_start - final_start) as usize, 0)
            };

            snow_shot_app_utils::overlay_image(
                &mut final_image,
                total_width,
                &crop_image,
                offset_x,
                offset_y,
                channel_count,
            );
        }

        Some(final_image)
    }

    pub fn export(&mut self) -> Option<image::DynamicImage> {
        if self.top_image_list.is_empty() && self.bottom_image_list.is_empty() {
            return None;
        }

        let total_scroll_size = self.top_image_size + self.bottom_image_size;
        if total_scroll_size <= 0 || self.image_width == 0 || self.image_height == 0 {
            return None;
        }

        let (total_width, total_height) = if self.current_direction == ScrollDirection::Vertical {
            (self.image_width as usize, total_scroll_size as usize)
        } else {
            (total_scroll_size as usize, self.image_height as usize)
        };

        const RGBA_CHANNEL_COUNT: usize = 4;
        let final_image = if let Some(final_image) =
            self.export_from_frames(total_width, total_height, RGBA_CHANNEL_COUNT)
        {
            final_image
        } else {
            self.export_from_segments(total_width, total_height, RGBA_CHANNEL_COUNT)
        };

        Some(image::DynamicImage::ImageRgba8(
            image::RgbaImage::from_raw(total_width as u32, total_height as u32, final_image)
                .unwrap(),
        ))
    }

    fn export_from_segments(
        &self,
        total_width: usize,
        total_height: usize,
        channel_count: usize,
    ) -> Vec<u8> {
        let mut final_image = vec![0; total_width * total_height * channel_count];

        let mut offset_x = if self.current_direction == ScrollDirection::Horizontal {
            self.top_image_size
        } else {
            0
        };
        let mut offset_y = if self.current_direction == ScrollDirection::Vertical {
            self.top_image_size
        } else {
            0
        };

        for scroll_image in self.bottom_image_list.iter() {
            let img = &scroll_image.image;
            snow_shot_app_utils::overlay_image(
                &mut final_image,
                total_width,
                img,
                offset_x as usize,
                offset_y as usize,
                channel_count,
            );

            if self.current_direction == ScrollDirection::Vertical {
                offset_y += img.height() as i32;
            } else {
                offset_x += img.width() as i32;
            }
        }

        offset_x = if self.current_direction == ScrollDirection::Horizontal {
            self.top_image_size
        } else {
            0
        };
        offset_y = if self.current_direction == ScrollDirection::Vertical {
            self.top_image_size
        } else {
            0
        };

        for scroll_image in self.top_image_list.iter() {
            let img = &scroll_image.image;

            if self.current_direction == ScrollDirection::Vertical {
                offset_y -= img.height() as i32;
            } else {
                offset_x -= img.width() as i32;
            }

            snow_shot_app_utils::overlay_image(
                &mut final_image,
                total_width,
                img,
                offset_x as usize,
                offset_y as usize,
                channel_count,
            );
        }

        final_image
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgba, RgbaImage};

    fn init_service(direction: ScrollDirection, side_size: i32) -> ScrollScreenshotService {
        let mut service = ScrollScreenshotService::new();
        service.init(direction, 1.0, 16, 64, 2, 24, side_size * 8 / 10, true);
        service
    }

    fn pixel_value(x: i32, y: i32) -> u8 {
        (x * 13 + y * 7 + (x / 5) * 11 + (y / 7) * 17).rem_euclid(256) as u8
    }

    fn vertical_image(position: i32, width: u32, height: u32) -> DynamicImage {
        let mut image = RgbaImage::new(width, height);

        for y in 0..height {
            for x in 0..width {
                let value = pixel_value(x as i32, position + y as i32);
                image.put_pixel(
                    x,
                    y,
                    Rgba([value, value.wrapping_add(23), 255 - value, 255]),
                );
            }
        }

        DynamicImage::ImageRgba8(image)
    }

    fn horizontal_image(position: i32, width: u32, height: u32) -> DynamicImage {
        let mut image = RgbaImage::new(width, height);

        for y in 0..height {
            for x in 0..width {
                let value = pixel_value(position + x as i32, y as i32);
                image.put_pixel(
                    x,
                    y,
                    Rgba([value, value.wrapping_add(19), 255 - value, 255]),
                );
            }
        }

        DynamicImage::ImageRgba8(image)
    }

    fn vertical_image_with_fixed_edges(position: i32, width: u32, height: u32) -> DynamicImage {
        let mut image = vertical_image(position, width, height).to_rgba8();

        for y in 0..height {
            for x in 0..width {
                if y < 10 {
                    image.put_pixel(x, y, Rgba([11, 22, 33, 255]));
                } else if y >= height - 10 {
                    image.put_pixel(x, y, Rgba([211, 222, 233, 255]));
                }
            }
        }

        DynamicImage::ImageRgba8(image)
    }

    fn assert_vertical_export_matches(
        service: &mut ScrollScreenshotService,
        start_position: i32,
        width: u32,
        height: u32,
    ) {
        let exported = service.export().unwrap().to_rgba8();
        assert_eq!(exported.width(), width);
        assert_eq!(exported.height(), height);

        for y in 0..height {
            for x in 0..width {
                let expected = vertical_image(start_position + y as i32, width, 1)
                    .to_rgba8()
                    .get_pixel(x, 0)
                    .0;
                assert_eq!(exported.get_pixel(x, y).0, expected);
            }
        }
    }

    fn assert_horizontal_export_matches(
        service: &mut ScrollScreenshotService,
        start_position: i32,
        width: u32,
        height: u32,
    ) {
        let exported = service.export().unwrap().to_rgba8();
        assert_eq!(exported.width(), width);
        assert_eq!(exported.height(), height);

        for y in 0..height {
            for x in 0..width {
                let expected = horizontal_image(start_position + x as i32, 1, height)
                    .to_rgba8()
                    .get_pixel(0, y)
                    .0;
                assert_eq!(exported.get_pixel(x, y).0, expected);
            }
        }
    }

    #[test]
    fn appends_vertical_bottom_and_top_without_duplicate_overlap() {
        let mut service = init_service(ScrollDirection::Vertical, 100);

        let first = service.handle_image(vertical_image(0, 32, 100), ScrollImageList::Bottom);
        assert_eq!(first.0.unwrap().0, 100);
        assert_eq!(service.bottom_image_size, 100);

        let second = service.handle_image(vertical_image(30, 32, 100), ScrollImageList::Bottom);
        assert_eq!(second.0.unwrap().0, 130);
        assert_eq!(service.bottom_image_size, 130);
        assert_eq!(service.bottom_image_list.len(), 2);

        let third = service.handle_image(vertical_image(-20, 32, 100), ScrollImageList::Top);
        assert_eq!(third.0.unwrap().0, -20);
        assert_eq!(service.top_image_size, 20);
        assert_eq!(service.top_image_list.len(), 1);

        assert_vertical_export_matches(&mut service, -20, 32, 150);
    }

    #[test]
    fn appends_horizontal_right_and_left_without_duplicate_overlap() {
        let mut service = init_service(ScrollDirection::Horizontal, 120);

        let first = service.handle_image(horizontal_image(0, 120, 24), ScrollImageList::Bottom);
        assert_eq!(first.0.unwrap().0, 120);
        assert_eq!(service.bottom_image_size, 120);

        let second = service.handle_image(horizontal_image(45, 120, 24), ScrollImageList::Bottom);
        assert_eq!(second.0.unwrap().0, 165);
        assert_eq!(service.bottom_image_size, 165);

        let third = service.handle_image(horizontal_image(-30, 120, 24), ScrollImageList::Top);
        assert_eq!(third.0.unwrap().0, -30);
        assert_eq!(service.top_image_size, 30);

        assert_horizontal_export_matches(&mut service, -30, 195, 24);
    }

    #[test]
    fn identical_frame_is_reported_as_no_change() {
        let mut service = init_service(ScrollDirection::Vertical, 80);

        service.handle_image(vertical_image(0, 24, 80), ScrollImageList::Bottom);
        let result = service.handle_image(vertical_image(0, 24, 80), ScrollImageList::Bottom);

        assert!(result.0.is_none());
        assert!(result.1);
        assert_eq!(service.top_image_size, 0);
        assert_eq!(service.bottom_image_size, 80);
    }

    #[test]
    fn export_uses_safe_frame_area_to_avoid_repeated_fixed_edges() {
        let mut service = init_service(ScrollDirection::Vertical, 100);

        service.handle_image(
            vertical_image_with_fixed_edges(0, 32, 100),
            ScrollImageList::Bottom,
        );
        service.handle_image(
            vertical_image_with_fixed_edges(30, 32, 100),
            ScrollImageList::Bottom,
        );

        let exported = service.export().unwrap().to_rgba8();
        assert_eq!(exported.height(), 130);

        for x in 0..32 {
            assert_eq!(exported.get_pixel(x, 0).0, [11, 22, 33, 255]);
            assert_eq!(exported.get_pixel(x, 129).0, [211, 222, 233, 255]);

            let middle_value = pixel_value(x as i32, 90);
            assert_eq!(
                exported.get_pixel(x, 90).0,
                [
                    middle_value,
                    middle_value.wrapping_add(23),
                    255 - middle_value,
                    255
                ]
            );
        }
    }
}
